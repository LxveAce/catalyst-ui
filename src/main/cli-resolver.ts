import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * CLI path resolution for spawned subprocesses.
 *
 * Why this exists: on Windows, node-pty's `pty.spawn(command, args, …)` does a
 * direct `CreateProcess` call — it does NOT go through the shell. That means
 * passing `command: 'ollama'` requires the binary to be named exactly `ollama`
 * (no extension), which never happens on Windows where binaries are `.exe` /
 * `.cmd` / `.bat`. Even when child_process.spawn is used with `shell: true`,
 * the shell only searches `process.env.PATH` as captured at app launch. If
 * the user installed Ollama AFTER launching Studio, the stale PATH means
 * `ollama` doesn't resolve.
 *
 * This resolver:
 *   1. Returns the input unchanged if it's already an absolute path that exists.
 *   2. On Windows, checks well-known install locations for known CLIs (ollama,
 *      gemini, aider).
 *   3. Falls back to `where.exe` (Windows) / `which` (POSIX) to query the OS.
 *   4. If all of that fails, returns the original bare command — spawn will
 *      fail with a clearer error than "ENOENT" because we logged the attempt.
 *
 * The function is sync (called from PtyManager.spawn which is sync). Probes
 * are bounded with timeouts so a broken PATH doesn't hang the app.
 */

/**
 * Try a list of candidate absolute paths; return the first one that exists.
 */
function firstExistingPath(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Well-known install locations per known CLI on Windows. The keys are the
 * bare command names users would type (e.g. `ollama`); the values are paths
 * that include the actual `.exe` / `.cmd` name.
 */
function windowsWellKnownPaths(command: string): string[] {
  const lad = process.env.LOCALAPPDATA;
  const pf = process.env['ProgramFiles'];
  const pf86 = process.env['ProgramFiles(x86)'];
  const home = os.homedir();
  switch (command.toLowerCase()) {
    case 'ollama':
      return [
        lad ? path.join(lad, 'Programs', 'Ollama', 'ollama.exe') : '',
        pf ? path.join(pf, 'Ollama', 'ollama.exe') : '',
        pf86 ? path.join(pf86, 'Ollama', 'ollama.exe') : '',
      ].filter(Boolean);
    case 'gemini':
      // npm global on Windows lands in %APPDATA%\npm or the Node runtime's
      // own dir; both expose a .cmd shim.
      return [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'gemini.cmd') : '',
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'gemini.ps1') : '',
      ].filter(Boolean);
    case 'aider':
      // pip global on Windows: %APPDATA%\Python\Scripts\aider.exe, or in a
      // venv's Scripts/. We can't enumerate venvs but the user-base path is
      // canonical for `pip install --user`.
      return [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Python', 'Scripts', 'aider.exe') : '',
        path.join(home, '.local', 'bin', 'aider.exe'),
      ].filter(Boolean);
    default:
      return [];
  }
}

/**
 * Use `where.exe` (Windows) or `which` (POSIX) to ask the OS for the binary.
 * Returns absolute path of the first match, or null if not found.
 */
function osLookupCommand(command: string): string | null {
  try {
    const isWin = process.platform === 'win32';
    const lookupBin = isWin ? 'where.exe' : 'which';
    const r = spawnSync(lookupBin, [command], {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    });
    if (r.status !== 0) return null;
    const firstLine = String(r.stdout || '').trim().split(/\r?\n/)[0];
    if (firstLine && fs.existsSync(firstLine)) return firstLine;
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a command to an absolute path when possible. Falls back to the
 * input on failure (spawn will then surface its own error).
 *
 * Caller-facing — used by PtyManager and any other spawn site that takes a
 * user-provided command name.
 */
export function resolveCommandPath(command: string): string {
  if (!command || typeof command !== 'string') return command;
  // Already absolute? Use as-is.
  if (path.isAbsolute(command)) {
    return fs.existsSync(command) ? command : command;
  }
  // On POSIX, bare commands work via PATH lookup at exec time; we don't
  // need to pre-resolve. Only Windows is broken without an extension.
  if (process.platform !== 'win32') {
    // Optional: still resolve so failed lookups surface a clearer error
    // pre-spawn. Cheap.
    const viaWhich = osLookupCommand(command);
    return viaWhich ?? command;
  }
  // Windows path. Check well-known install dirs first (cheap, no spawn).
  const known = firstExistingPath(windowsWellKnownPaths(command));
  if (known) return known;
  // Fallback: ask the OS via where.exe. This queries the process's PATH —
  // if the user installed a CLI AFTER launching Studio, this will still
  // miss. Documented; the well-known dirs above cover that case for the
  // CLIs we know about.
  const viaWhere = osLookupCommand(command);
  if (viaWhere) return viaWhere;
  // Last resort — return the bare name. Spawn will fail with a less
  // helpful error, but we did our best.
  return command;
}

/**
 * Diagnostic helper: returns a structured account of how a command resolved.
 * Useful for logging on spawn failures so users can see "we looked here, here,
 * and here." Not currently surfaced in the UI but printed on stderr so
 * `--enable-logging` runs can capture it.
 */
export function explainResolution(command: string): string {
  const resolved = resolveCommandPath(command);
  if (resolved === command) {
    return `resolveCommandPath: '${command}' did not resolve to an absolute path. Tried well-known install dirs + ${process.platform === 'win32' ? 'where.exe' : 'which'} lookup.`;
  }
  return `resolveCommandPath: '${command}' → '${resolved}'`;
}
