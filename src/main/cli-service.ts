import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { CliStatus, CliOnboardingState } from '../shared/types';
import { findBundledRuntime, targetRuntimePaths } from './runtime-paths';

const execFileAsync = promisify(execFile);

/**
 * Caller-supplied progress sink. CliService streams npm install output
 * line-by-line via this callback so the renderer can show real-time
 * install progress in the onboarding modal.
 */
export type CliInstallProgressSink = (line: string) => void;

const ONBOARDING_FILE = 'cli-onboarding.json';
const ONBOARDING_DEFAULT: CliOnboardingState = {
  complete: false,
  completedAt: null,
};

/** Hard timeout for `claude doctor`. Doctor is normally <2 s; longer means
 * something is wedged. */
const DOCTOR_TIMEOUT_MS = 10000;

/** Hard timeout for the npm install fallback. CLI is ~30 MB; on a slow
 * connection this can legitimately take a couple minutes. */
const NPM_INSTALL_TIMEOUT_MS = 300000;

/**
 * Surfaces information about the Claude Code CLI on this machine and
 * provides one-click recovery for the Phase 4 soft-fail path (NSIS
 * bootstrap's npm install failed → user has Studio but no CLI).
 *
 * Source-of-truth is `claude doctor` per Phase 1 red-team M1 — file
 * existence is too brittle if Claude Code ever changes its credentials
 * storage location. If doctor isn't available (CLI not installed at all),
 * we report `installed: false` and `authenticated: false`.
 *
 * Onboarding completion is persisted in `<userData>/cli-onboarding.json`.
 * The renderer-side modal reads this on startup to decide whether to show.
 */
export class CliService {
  private onboardingPath: string;

  constructor() {
    this.onboardingPath = path.join(app.getPath('userData'), ONBOARDING_FILE);
  }

  /**
   * Returns the resolved `claude` executable path. Mirrors the resolution
   * order from PtyManager.findClaudePath() so doctor checks the same
   * binary the terminal would spawn. Single source of truth via
   * runtime-paths.ts.
   */
  private findClaudePath(): { path: string; source: CliStatus['source'] } {
    if (app.isPackaged) {
      const bundled = findBundledRuntime();
      if (bundled) return { path: bundled.claudeBin, source: 'bundled' };
    }

    // Legacy + dev fallback.
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      path.join(os.homedir(), '.local', 'bin', 'claude'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return { path: candidate, source: 'path' };
    }

    // PATH fallback: trust that `claude` resolves at exec time. We can't
    // prove it exists without executing — claude doctor will tell us.
    return { path: 'claude', source: 'path' };
  }

  /**
   * Run `claude doctor` and infer the CLI state.
   *
   * Exit-code semantics (empirically — Anthropic docs only say doctor
   * gives "a more detailed check"):
   *   0 → CLI installed AND authenticated.
   *   non-zero → CLI installed but something's off; parse stderr/stdout
   *     for auth-related strings to disambiguate.
   *   ENOENT (spawn fails) → CLI not installed.
   */
  async getStatus(): Promise<CliStatus> {
    const { path: claudeBin, source } = this.findClaudePath();

    try {
      const { stdout, stderr } = await execFileAsync(claudeBin, ['doctor'], {
        timeout: DOCTOR_TIMEOUT_MS,
        windowsHide: true,
      });
      const combined = `${stdout}\n${stderr}`.toLowerCase();
      // Best-effort version extraction — looks for a "version: X.Y.Z" or
      // "claude vX.Y.Z" pattern. Doctor output format isn't documented,
      // so this is opportunistic; failure here doesn't fail the call.
      const versionMatch = combined.match(/(?:version[:\s]+|claude\s+v)(\d+\.\d+\.\d+)/);
      // Doctor's exit-code-0 is our authenticated signal, but we also
      // check for explicit "not authenticated" / "log in" wording in case
      // doctor exit codes change in a future CLI version.
      const looksAuthenticated = !/(not authenticated|please log in|please sign in|run.*claude login)/.test(
        combined
      );
      return {
        installed: true,
        authenticated: looksAuthenticated,
        version: versionMatch ? versionMatch[1] : null,
        source,
        lastError: null,
      };
    } catch (e: unknown) {
      // ENOENT = binary not found on PATH (or bundled location).
      const err = e as NodeJS.ErrnoException & { stderr?: string; code?: string };
      if (err.code === 'ENOENT') {
        return {
          installed: false,
          authenticated: false,
          version: null,
          source: 'missing',
          lastError: 'Claude Code CLI not found on this machine',
        };
      }
      // Non-zero exit. Could be: not authenticated, broken install, etc.
      // Look at the output for auth-specific hints.
      const errOutput = `${err.stderr ?? ''}\n${err.message}`.toLowerCase();
      const looksLikeAuthMissing = /(not authenticated|please log in|please sign in|run.*claude login)/.test(
        errOutput
      );
      // If output mentions auth, the CLI IS installed but unauthenticated.
      // Otherwise it's some other doctor failure — still report installed
      // but unauthenticated, with the error message for diagnostics.
      return {
        installed: true,
        authenticated: false,
        version: null,
        source,
        lastError: looksLikeAuthMissing
          ? 'Sign in required'
          : (err.message || 'claude doctor failed'),
      };
    }
  }

  /**
   * Soft-fail recovery for the Phase 4 NSIS bootstrap: re-runs the
   * npm install that should have happened at install time. Uses the
   * bundled npm so we don't depend on the user having Node installed.
   *
   * Optional `onProgress` streams each line of npm output as it arrives —
   * the renderer subscribes via the cli:install-progress IPC channel
   * to show real-time progress in the onboarding modal (Phase 6 M1).
   *
   * Only meaningful in packaged builds — in dev there's no bundled
   * runtime to install into. Returns a structured result rather than
   * throwing so the renderer can show error details.
   */
  async install(
    onProgress?: CliInstallProgressSink
  ): Promise<{ ok: boolean; output: string; error: string | null }> {
    if (!app.isPackaged) {
      return {
        ok: false,
        output: '',
        error: 'Install-CLI from app is only available in packaged builds. In dev, run `npm install -g @anthropic-ai/claude-code` manually.',
      };
    }

    // Where the runtime lives differs by platform — see runtime-paths.ts.
    // Windows: prefers resources/runtime/ (NSIS bootstrap layout).
    // macOS/Linux: <userData>/runtime/ (in-app bootstrap, app dir is RO).
    const { runtimeDir, nodeBin, npmCli } = targetRuntimePaths();

    // On non-Windows platforms, the runtime dir may not exist yet because
    // the first-launch in-app bootstrap creates it on demand. We need to
    // download Node first if it's missing. For now, refuse and tell the
    // user to reinstall — the full first-launch bootstrap (download Node,
    // extract, then run npm install) is tracked as Phase 11 work for the
    // macOS/Linux branches. Until that lands, packaged macOS/Linux builds
    // require Node + Claude CLI on system PATH (degraded but functional).
    if (!fs.existsSync(nodeBin) || !fs.existsSync(npmCli)) {
      if (process.platform === 'win32') {
        return {
          ok: false,
          output: '',
          error: 'Bundled Node runtime is missing. Reinstall Claude Code Studio to recover.',
        };
      }
      return {
        ok: false,
        output: '',
        error: 'In-app Node bootstrap for macOS/Linux is not yet implemented. Install Claude Code manually with: npm install -g @anthropic-ai/claude-code',
      };
    }

    // Ensure runtime dir exists before npm install writes into it (mainly
    // matters when the bundled Node is present but the prefix subtree
    // hasn't been seeded yet — npm wants to write package-lock placeholders).
    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
    } catch {
      // mkdir failure here means the install will fail anyway with a
      // clearer error from npm — let it.
    }

    // Use spawn (not execFile) so we can stream stdout/stderr line-by-line
    // to the renderer. execFile buffers all output until exit — fine for
    // small commands but a poor UX for a 30-90 second install. Drop
    // `--silent` so npm actually emits progress.
    const args = [
      npmCli,
      'install',
      '--prefix',
      runtimeDir,
      '--registry=https://registry.npmjs.org/',
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--progress=false',
      '@anthropic-ai/claude-code',
    ];

    return new Promise((resolve) => {
      const collected: string[] = [];
      const child = spawn(nodeBin, args, { windowsHide: true });
      let buffer = '';

      const flushLines = (chunk: string) => {
        buffer += chunk;
        let nl: number;
        // eslint-disable-next-line no-cond-assign
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          if (line.length > 0) {
            collected.push(line);
            try {
              onProgress?.(line);
            } catch {
              // never let renderer-side handler break the install
            }
          }
        }
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', flushLines);
      child.stderr?.on('data', flushLines);

      const timeoutHandle = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
      }, NPM_INSTALL_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        resolve({
          ok: false,
          output: collected.join('\n'),
          error: err.message || 'npm install spawn failed',
        });
      });

      child.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        // Flush any trailing buffer that didn't end with a newline.
        if (buffer.length > 0) {
          collected.push(buffer);
          try { onProgress?.(buffer); } catch { /* ignore */ }
          buffer = '';
        }
        if (code === 0) {
          resolve({ ok: true, output: collected.join('\n'), error: null });
        } else {
          resolve({
            ok: false,
            output: collected.join('\n'),
            error: `npm install exited with code ${code ?? 'null'}`,
          });
        }
      });
    });
  }

  getOnboardingState(): CliOnboardingState {
    try {
      const raw = fs.readFileSync(this.onboardingPath, 'utf8');
      const parsed = JSON.parse(raw);
      // Defensive — file could be hand-edited / from a future version.
      return {
        complete: parsed.complete === true,
        completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : null,
      };
    } catch {
      return { ...ONBOARDING_DEFAULT };
    }
  }

  setOnboardingComplete(): CliOnboardingState {
    const next: CliOnboardingState = {
      complete: true,
      completedAt: Date.now(),
    };
    try {
      fs.writeFileSync(this.onboardingPath, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      // Persistence failure is non-fatal — the modal just shows again
      // next launch. Don't block the user on filesystem issues.
    }
    return next;
  }

  /** Reset for testing / user request via SettingsPanel. */
  resetOnboarding(): CliOnboardingState {
    try {
      fs.unlinkSync(this.onboardingPath);
    } catch {
      // Already gone; fine.
    }
    return { ...ONBOARDING_DEFAULT };
  }
}
