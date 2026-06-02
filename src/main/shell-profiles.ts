import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { ShellProfile } from '../shared/types';

/**
 * Runtime detection of the system shells available on this machine.
 *
 * Powers the "Terminals" group in the new-tab profile picker (Catalyst UI):
 * the user can open a plain CMD / PowerShell / Git Bash / WSL (Windows) or
 * bash / zsh / fish / their login shell (macOS + Linux) as a tab, alongside
 * Claude and model profiles.
 *
 * Only shells that actually exist on disk are returned, so the picker never
 * offers a profile that would fail to spawn. Results are cached after the
 * first probe (shells don't appear/disappear during a session).
 */

let cache: ShellProfile[] | null = null;

function exists(p: string | undefined | null): p is string {
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Bounded POSIX `which` lookup. Returns an absolute path or null. */
function which(cmd: string): string | null {
  try {
    const r = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0) return null;
    const line = String(r.stdout || '').trim().split(/\r?\n/)[0];
    return exists(line) ? line : null;
  } catch {
    return null;
  }
}

function detectWindows(): ShellProfile[] {
  const out: ShellProfile[] = [];
  const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const sys32 = path.join(sysRoot, 'System32');
  const pf = process.env['ProgramFiles'];
  const pf86 = process.env['ProgramFiles(x86)'];
  const lad = process.env.LOCALAPPDATA;

  // Command Prompt — effectively always present. Prefer %ComSpec%.
  const cmd =
    exists(process.env.ComSpec) ? process.env.ComSpec! : path.join(sys32, 'cmd.exe');
  if (exists(cmd)) {
    out.push({ id: 'cmd', name: 'Command Prompt', command: cmd, args: [] });
  }

  // Windows PowerShell 5.x — ships with Windows.
  const wps = path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(wps)) {
    out.push({ id: 'powershell', name: 'Windows PowerShell', command: wps, args: ['-NoLogo'] });
  }

  // PowerShell 7+ (pwsh) — optional cross-platform install.
  const pwsh = [
    pf ? path.join(pf, 'PowerShell', '7', 'pwsh.exe') : '',
    pf86 ? path.join(pf86, 'PowerShell', '7', 'pwsh.exe') : '',
  ].find(exists);
  if (pwsh) {
    out.push({ id: 'pwsh', name: 'PowerShell 7', command: pwsh, args: ['-NoLogo'] });
  }

  // Git Bash — optional (ships with Git for Windows).
  const gitBash = [
    pf ? path.join(pf, 'Git', 'bin', 'bash.exe') : '',
    pf86 ? path.join(pf86, 'Git', 'bin', 'bash.exe') : '',
    lad ? path.join(lad, 'Programs', 'Git', 'bin', 'bash.exe') : '',
  ].find(exists);
  if (gitBash) {
    out.push({ id: 'git-bash', name: 'Git Bash', command: gitBash, args: ['--login', '-i'] });
  }

  // WSL ("Linux for Windows") — present when the optional feature is enabled.
  const wsl = path.join(sys32, 'wsl.exe');
  if (exists(wsl)) {
    out.push({ id: 'wsl', name: 'WSL (Linux)', command: wsl, args: [] });
  }

  return out;
}

function detectPosix(): ShellProfile[] {
  const out: ShellProfile[] = [];
  const seenCommand = new Set<string>();
  const add = (id: string, name: string, command: string, args: string[] = []) => {
    if (seenCommand.has(command)) return;
    seenCommand.add(command);
    out.push({ id, name, command, args });
  };

  // The user's configured login shell first — most-expected default. Given a
  // unique 'login' id so it can't collide with the generic entries below.
  const loginShell = process.env.SHELL;
  if (exists(loginShell)) {
    const base = path.basename(loginShell);
    add('login', `${cap(base)} (login shell)`, loginShell);
  }

  const known: Array<{ id: string; name: string }> = [
    { id: 'bash', name: 'Bash' },
    { id: 'zsh', name: 'Zsh' },
    { id: 'fish', name: 'fish' },
    { id: 'sh', name: 'sh' },
  ];
  const dirs = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
  for (const k of known) {
    let resolved: string | null = null;
    for (const d of dirs) {
      const p = path.join(d, k.id);
      if (exists(p)) {
        resolved = p;
        break;
      }
    }
    if (!resolved) resolved = which(k.id);
    if (resolved) add(k.id, k.name, resolved);
  }

  return out;
}

/** Detected shells for this platform. Cached; pass `force` to re-probe. */
export function detectShellProfiles(force = false): ShellProfile[] {
  if (cache && !force) return cache;
  cache = process.platform === 'win32' ? detectWindows() : detectPosix();
  return cache;
}

/** Look up a detected shell by its profile id, or null if not present. */
export function getShellProfile(id: string): ShellProfile | null {
  return detectShellProfiles().find((s) => s.id === id) ?? null;
}
