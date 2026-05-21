import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { GitRepoState } from '../shared/types';

const execFileAsync = promisify(execFile);

const EMPTY_STATE: GitRepoState = {
  found: false,
  root: null,
  branch: null,
  upstream: null,
  remoteUrl: null,
  owner: null,
  repo: null,
  ahead: 0,
  behind: 0,
  dirty: false,
  staged: 0,
  modified: 0,
  untracked: 0,
};

export class GitService {
  private cwd: string;

  constructor(initialCwd?: string) {
    const sanitized = sanitizeCwd(initialCwd);
    this.cwd = sanitized ?? os.homedir();
  }

  getCwd(): string {
    return this.cwd;
  }

  setCwd(next: string): string {
    const sanitized = sanitizeCwd(next);
    if (sanitized) {
      this.cwd = sanitized;
    }
    return this.cwd;
  }

  async detect(startPath?: string): Promise<GitRepoState> {
    const sanitized = startPath ? sanitizeCwd(startPath) : null;
    const start = sanitized ?? this.cwd;
    const root = this.findRoot(start);
    if (!root) {
      return { ...EMPTY_STATE };
    }

    const [branch, upstream, remoteUrl, aheadBehind, status] = await Promise.all([
      this.runText(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      this.runText(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
      this.runText(root, ['config', '--get', 'remote.origin.url']),
      this.aheadBehind(root),
      this.statusCounts(root),
    ]);

    const parsed = parseGitHubUrl(remoteUrl);

    return {
      found: true,
      root,
      branch: branch || null,
      upstream: upstream || null,
      remoteUrl: remoteUrl || null,
      owner: parsed?.owner ?? null,
      repo: parsed?.repo ?? null,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      dirty: status.staged + status.modified + status.untracked > 0,
      staged: status.staged,
      modified: status.modified,
      untracked: status.untracked,
    };
  }

  private findRoot(start: string): string | null {
    let current = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(current, '.git'))) return current;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }

  private async runText(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        windowsHide: true,
        timeout: 5000,
        killSignal: 'SIGTERM',
      });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  private async aheadBehind(cwd: string): Promise<{ ahead: number; behind: number }> {
    const raw = await this.runText(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    if (!raw) return { ahead: 0, behind: 0 };
    const [aheadStr, behindStr] = raw.split(/\s+/);
    return {
      ahead: parseInt(aheadStr, 10) || 0,
      behind: parseInt(behindStr, 10) || 0,
    };
  }

  private async statusCounts(cwd: string): Promise<{
    staged: number;
    modified: number;
    untracked: number;
  }> {
    const raw = await this.runText(cwd, ['status', '--porcelain=v1']);
    if (!raw) return { staged: 0, modified: 0, untracked: 0 };

    let staged = 0;
    let modified = 0;
    let untracked = 0;
    for (const line of raw.split('\n')) {
      if (line.length < 2) continue;
      const x = line[0];
      const y = line[1];
      if (x === '?' && y === '?') {
        untracked++;
        continue;
      }
      if (x !== ' ' && x !== '?') staged++;
      if (y !== ' ' && y !== '?') modified++;
    }
    return { staged, modified, untracked };
  }
}

function sanitizeCwd(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (process.platform === 'win32' && /^[\\/][\\/]/.test(trimmed)) {
    return null;
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(trimmed);
  } catch {
    return null;
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }
  return resolved;
}

export function parseGitHubUrl(
  url: string | null | undefined
): { owner: string; repo: string } | null {
  if (!url) return null;
  const trimmed = url.trim();

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  const httpMatch = trimmed.match(
    /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[/?#].*)?$/
  );
  if (httpMatch) return { owner: httpMatch[1], repo: httpMatch[2] };

  const sshUrlMatch = trimmed.match(
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
  );
  if (sshUrlMatch) return { owner: sshUrlMatch[1], repo: sshUrlMatch[2] };

  return null;
}
