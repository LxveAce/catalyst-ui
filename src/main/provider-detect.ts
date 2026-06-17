import { spawn } from 'node:child_process';
import type { ProviderId } from '../shared/types';
import { resolveCommandPath } from './cli-resolver';

/**
 * Per-provider CLI availability detection. Used by the model catalog to
 * gate Launch buttons on "CLI is actually installed on PATH" — for API
 * providers other than Anthropic (which the app bundles its own Claude
 * runtime for), we don't bundle anything. Users install Gemini-CLI /
 * Aider / etc. themselves via pip/npm; the UI surfaces install
 * instructions via `ProviderSetupModal` when detection fails.
 *
 * Detection is cached for the session — re-detecting on every panel
 * remount would spawn child processes constantly. The cache is cleared
 * when the app restarts. UI can force a fresh probe via `force=true`.
 */

interface ProviderCliInfo {
  /** Canonical id for provider auth keys + interceptor patterns. Some
   *  CLIs are usable across providers (Aider with --model gpt-4o etc.);
   *  in that case we still attribute the detection to the CLI's "primary"
   *  provider for setup-instructions purposes. */
  provider: ProviderId | 'aider';
  /** Argv[0] expected on PATH. */
  command: string;
  /** Args to print the version (so we can confirm execution, not just PATH). */
  versionArgs: string[];
  /** Friendly install command shown in the setup modal. */
  installHint: string;
  /** Where the user can get the install bits. */
  installUrl: string;
}

const PROVIDER_CLIS: Record<string, ProviderCliInfo> = {
  gemini: {
    provider: 'gemini',
    command: 'gemini',
    versionArgs: ['--version'],
    installHint: 'npm install -g @google/gemini-cli',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  aider: {
    provider: 'aider',
    command: 'aider',
    versionArgs: ['--version'],
    installHint: 'python -m pip install -U aider-chat',
    installUrl: 'https://aider.chat',
  },
};

export interface ProviderDetectResult {
  cli: string;
  installed: boolean;
  /** Captured version string when installed, else null. */
  version: string | null;
  installHint: string;
  installUrl: string;
}

class ProviderDetectService {
  private static singleton: ProviderDetectService | null = null;
  private cache = new Map<string, ProviderDetectResult>();

  static instance(): ProviderDetectService {
    if (!ProviderDetectService.singleton) {
      ProviderDetectService.singleton = new ProviderDetectService();
    }
    return ProviderDetectService.singleton;
  }

  /** List all known CLIs we know how to detect, with their current
   *  detection result. Probes lazily on first call per CLI. */
  async list(force = false): Promise<ProviderDetectResult[]> {
    const out: ProviderDetectResult[] = [];
    for (const id of Object.keys(PROVIDER_CLIS)) {
      out.push(await this.get(id, force));
    }
    return out;
  }

  async get(cli: string, force = false): Promise<ProviderDetectResult> {
    const info = PROVIDER_CLIS[cli];
    if (!info) {
      return {
        cli,
        installed: false,
        version: null,
        installHint: '',
        installUrl: '',
      };
    }
    if (!force) {
      const cached = this.cache.get(cli);
      if (cached) return cached;
    }
    const probe = await this.probe(info);
    this.cache.set(cli, probe);
    return probe;
  }

  private async probe(info: ProviderCliInfo): Promise<ProviderDetectResult> {
    const result: ProviderDetectResult = {
      cli: info.command,
      installed: false,
      version: null,
      installHint: info.installHint,
      installUrl: info.installUrl,
    };
    try {
      const versionOutput = await runProbe(info.command, info.versionArgs);
      if (versionOutput !== null) {
        result.installed = true;
        result.version = versionOutput.trim().split('\n')[0]?.slice(0, 120) ?? null;
      }
    } catch {
      // ENOENT or any other spawn error → not installed.
    }
    return result;
  }
}

export const providerDetect = ProviderDetectService.instance();

function runProbe(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    // Resolve to an absolute path on Windows where bare 'aider' / 'gemini'
    // need '.exe' / '.cmd' extensions. cli-resolver handles well-known
    // install dirs + where.exe lookup. Returns the input if unresolved.
    const resolvedCommand = resolveCommandPath(command);
    // shell:true on Windows lets the shell handle .cmd / .bat shims that
    // npm-installed CLIs use. Cheap to do regardless of platform — POSIX
    // behavior is unchanged since the shell pass-through is transparent.
    const useShell = process.platform === 'win32';
    let child;
    try {
      child = spawn(resolvedCommand, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    // 8s — generous for Python CLI cold start (aider can take 3-5s to
    // import on first run from a slow disk). Was 4s; raised after the
    // post-Cat 6 audit found false-negative detections.
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve(null);
    }, 8000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on('exit', (code: number | null) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      // Accept output regardless of exit code — some CLIs exit non-zero
      // on `--version` but still print useful info. The presence of any
      // output is what tells us the binary exists; the exit code is
      // not a reliable signal across the CLI ecosystem.
      const combined = (stdout || '') + (stderr ? '\n' + stderr : '');
      if (combined.length === 0 && code !== 0) {
        // Truly no output AND non-zero exit = binary probably not found.
        resolve(null);
        return;
      }
      resolve(combined || '');
    });
  });
}
