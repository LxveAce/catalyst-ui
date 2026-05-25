import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Where the bundled Node + Claude CLI live in a packaged build.
 *
 * Layout differs by platform because the bootstrap mechanism does:
 *
 * - **Windows:** NSIS installer writes during install →
 *   `<install>/resources/runtime/`
 *     - node: `node.exe`
 *     - npm-cli: `node_modules/npm/bin/npm-cli.js`
 *     - claude: `claude.cmd` (npm-shim) or `claude.exe`
 *
 * - **macOS:** app installs to /Applications via DMG (read-only by
 *   default); first-launch in-app bootstrap writes to userData →
 *   `<userData>/runtime/`
 *     - node: `bin/node`
 *     - npm-cli: `lib/node_modules/npm/bin/npm-cli.js`
 *     - claude: `bin/claude` (npm symlink)
 *
 * - **Linux:** same `<userData>/runtime/` pattern as macOS for
 *   consistency. Works for AppImage / deb / rpm since the install dir
 *   may be read-only or shared.
 *
 * On Windows we ALSO check the userData location as a fallback so the
 * soft-fail recovery path (cli-service.install() re-run from the
 * onboarding modal) lands somewhere PtyManager can still find.
 */

export interface RuntimePaths {
  /** Directory containing the bundled runtime. May not exist if bootstrap failed. */
  runtimeDir: string;
  /** Full path to bundled node binary. */
  nodeBin: string;
  /** Full path to bundled npm-cli.js. */
  npmCli: string;
  /** Full path to `claude` executable (cmd shim on Windows, real binary on POSIX). */
  claudeBin: string;
}

/** Returns runtime paths for a given base directory (no existence checks). */
function pathsFor(baseDir: string): RuntimePaths {
  if (process.platform === 'win32') {
    return {
      runtimeDir: baseDir,
      nodeBin: path.join(baseDir, 'node.exe'),
      npmCli: path.join(baseDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      claudeBin: path.join(baseDir, 'claude.cmd'),
    };
  }
  // POSIX (macOS + Linux): npm prefix-install layout uses bin/ and lib/.
  return {
    runtimeDir: baseDir,
    nodeBin: path.join(baseDir, 'bin', 'node'),
    npmCli: path.join(baseDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    claudeBin: path.join(baseDir, 'bin', 'claude'),
  };
}

/**
 * Locations where the bundled runtime might live, in priority order.
 * Callers iterate and pick the first whose `claudeBin` exists.
 */
export function candidateRuntimeRoots(): string[] {
  const candidates: string[] = [];
  if (app.isPackaged && process.platform === 'win32') {
    // Phase 4 NSIS bootstrap writes here at install time.
    candidates.push(path.join(process.resourcesPath, 'runtime'));
  }
  // Cross-platform fallback / non-Windows primary: first-launch in-app
  // bootstrap location. Also covers Windows soft-fail recovery.
  candidates.push(path.join(app.getPath('userData'), 'runtime'));
  return candidates;
}

/**
 * Returns paths to the first existing bundled runtime, or `null` if none
 * are present (i.e. CLI must be on system PATH, or absent entirely).
 */
export function findBundledRuntime(): RuntimePaths | null {
  for (const root of candidateRuntimeRoots()) {
    const paths = pathsFor(root);
    if (fs.existsSync(paths.claudeBin)) return paths;
  }
  return null;
}

/**
 * Returns the runtime location where `CliService.install()` should write.
 *
 * On Windows in packaged builds, prefers `resources/runtime/` to match
 * the NSIS bootstrap layout (the per-user install path used by
 * `oneClick=true`, `perMachine=false` lands under
 * `%LocalAppData%\Programs\<name>\` which is user-writable — no UAC).
 *
 * On macOS + Linux, always `<userData>/runtime/` since the app dir is
 * typically read-only or shared.
 */
export function targetRuntimeRoot(): string {
  if (app.isPackaged && process.platform === 'win32') {
    return path.join(process.resourcesPath, 'runtime');
  }
  return path.join(app.getPath('userData'), 'runtime');
}

/** Returns runtime paths for the install target, regardless of existence. */
export function targetRuntimePaths(): RuntimePaths {
  return pathsFor(targetRuntimeRoot());
}
