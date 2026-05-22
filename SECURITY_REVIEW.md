# Security & Correctness Review — Phase 4

> Reviewed: 2026-05-21 · Branch: phase-4-github-integration · Reviewer: red-team agent

## Summary

Phase 4 ships solid bones — `contextIsolation: true`, `nodeIntegration: false`, fuses partially set, a sensible IPC surface, atomic file writes — but three live exploit/data-loss paths exist on first install: the compact controller can clobber `~/.claude/settings.json` on any parse error, the GitHub PAT silently lands in plaintext on systems where `safeStorage` is unavailable while the UI claims the opposite, and the renderer has no CSP/sandbox while exposing `terminal.sendInput` (a direct shell-injection primitive into the Claude PTY). Several Mediums and one important Authz issue (over-broad default PAT scopes) round out the list.

## Critical (fix before merge)

### [C1] CompactController silently overwrites `~/.claude/settings.json` with `{}` on any parse error
**Where:** `src/main/compact-controller.ts:113-118` (`install` → catch → write), `:136-140` (`uninstall` → catch → write), and the root cause `:177-189` (`readSettings`/`writeSettings`).
**Issue:** `readSettings()` returns `{}` on *any* JSON read failure (missing file, malformed file, partial write by another tool, transient lock, UTF-8 BOM). Both `install()` and `uninstall()` then call `this.writeSettings(settings)` on that empty object, and the "atomic" tmp+rename guarantees the corrupted state replaces the original file *durably*. There is no backup; the user's hook config, env, permissions, allowedTools, model preferences — everything in `~/.claude/settings.json` — is gone.
**Exploit/scenario:** First install on any user who already has a `~/.claude/settings.json` containing JSONC-style comments or trailing commas (common — humans edit this), or who clicks Install while another tool is mid-write. One click in the Compact panel wipes their CLI configuration. No prompt, no undo.
**Fix:** In `readSettings()` distinguish ENOENT (return `{}` — fine to write) from parse failure (throw / return discriminated `{ok:false}`). In `install()`/`uninstall()`/`writeSettings()`, refuse to write when the prior read was unparseable; surface a structured error to the renderer. Bonus: write a `.bak` copy of the previous file alongside the tmp before rename.

### [C2] GitHub PAT silently persisted in plaintext when `safeStorage` is unavailable, while UI tells the user the token is encrypted
**Where:** `src/main/github-service.ts:191-200` (`persistToken`), `:34` (`hasStoredToken`), `:202-211` (`readToken`); UI claim at `src/renderer/components/github/ConnectGitHub.tsx:49-52` ("stored locally and encrypted with the OS keychain").
**Issue:** `safeStorage.isEncryptionAvailable()` returns false on Linux without an unlocked keyring, on some headless macOS contexts, and (per Electron docs) can return false on Windows when DPAPI is unavailable for the current profile. In that case the code writes `this.store.plainToken = token` to `<userData>/github-auth.json` in cleartext. The UI string is unconditional, so the user has consented to a security guarantee that the code may silently break. `GitHubAuthState` has no `encrypted` field, so neither the renderer nor any future audit log can know which mode is active.
**Exploit/scenario:** Any process running as the user (a browser extension's native messaging host, another Electron app, a malicious npm postinstall) can read the JSON and exfiltrate a `repo`-scoped PAT — i.e. full write access to every private repo the user owns. Recovery requires manual revocation on github.com because `clearToken` (`:62-68`) doesn't call `applications.deleteAuthorization`.
**Fix:**
1. Add `encrypted: boolean` to `GitHubAuthState`; populate from `safeStorage.isEncryptionAvailable()` and surface it in `ConnectGitHub.tsx` so the copy is honest.
2. When `isEncryptionAvailable()` returns false, refuse to persist by default and require an explicit "store in plaintext anyway" toggle.
3. On Windows specifically, harden the `<userData>/github-auth.json` ACL after write (or use `electron-store`'s encryption) so other-user readability is impossible even in the encrypted-blob case.
4. On `clearToken`, attempt token revocation via the GitHub API before deleting locally so the disconnect button matches user intent.

### [C3] No CSP + `sandbox: false` (default) + `terminal.sendInput` exposed = any renderer XSS becomes arbitrary command execution in the Claude PTY
**Where:** `src/renderer/index.html:1-13` (no `<meta http-equiv="Content-Security-Policy">`), `src/main/index.ts:37-42` (`webPreferences` omits `sandbox: true`), `src/preload/preload.ts:15-17` (`terminal.sendInput`) wired to `src/main/index.ts:86-88` which forwards into `ptyManager.write()` with no rate limiting and no input filtering.
**Issue:** The renderer renders untrusted strings from GitHub (PR titles, issue titles, commit messages, label names, branch names, repo `description`/`topics`, `authorLogin`) via React text interpolation — currently safe because React escapes. But the only thing standing between a future `dangerouslySetInnerHTML` / markdown-render / SVG-injection bug and full shell takeover is React's escaping. There is no CSP defense-in-depth, no renderer sandbox, and `electronAPI.terminal.sendInput("rm -rf ~\r")` from any executing renderer script will be typed into Claude's PTY as if the user typed it. The blast radius is "everything the user can do from the terminal."
**Exploit/scenario:** Phase 5-7 will plausibly add markdown rendering (issue bodies, PR descriptions) or icon/SVG content from labels. The first such regression — or a vulnerable transitive React/xterm dep — pivots from "data in DOM" to "command execution in shell," because the preload doesn't require any user gesture before forwarding bytes to the PTY.
**Fix:**
1. Add a strict CSP meta tag in `src/renderer/index.html`: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com https://*.githubusercontent.com; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none';">` Also set `Content-Security-Policy` via `session.defaultSession.webRequest.onHeadersReceived` so it applies to dev too.
2. Set `webPreferences.sandbox: true` in `src/main/index.ts:37` and rewrite the preload to use only `contextBridge`/`ipcRenderer` (it already does — sandbox is compatible).
3. In `src/main/index.ts` add `app.on('web-contents-created', (_, wc) => { wc.setWindowOpenHandler(() => ({action:'deny'})); wc.on('will-navigate', (e, url) => { if (!isDevURL(url)) e.preventDefault(); }); })` to prevent the only window from being navigated away from the app shell.
4. Consider gating `terminal.sendInput` to xterm-originated focus events (require a "user gesture" sentinel) or move it behind a confirmation overlay for non-printable / multi-line payloads.

## High (fix soon)

### [H1] `GITHUB_OPEN_EXTERNAL` accepts any `http://` URL and any host
**Where:** `src/main/index.ts:164-170`.
**Issue:** The guard is `/^https?:\/\//.test(url)` — no host allowlist, allows plain `http`. `shell.openExternal` on Windows will happily launch `http://internal-router.lan/admin?reset=1` or `http://127.0.0.1:port/...` against localhost services the user has running. Combined with C3, an attacker who can call `electronAPI.github.openExternal` from the renderer can perform SSRF-like browser-driven actions against the user's intranet, or open `http://` phishing pages styled to look like GitHub.
**Fix:** Restrict to `https:` only and to a host allowlist (`github.com`, `gist.github.com`, `*.github.com`, `docs.github.com`). Parse via `new URL(url)` and validate `protocol === 'https:'` plus `hostname.endsWith('.github.com') || hostname === 'github.com'`.

### [H2] GitHub PAT default scope `repo,read:user` over-requests by ~10x what the app uses
**Where:** `src/renderer/components/github/ConnectGitHub.tsx:27-31` (prefills `scopes=repo,read:user` in the "Generate token" link), reinforced by the UI text at `:127-128`.
**Issue:** Phase 4 only reads: `repos.get`, `repos.listCommits`, `repos.listBranches`, `pulls.list`, `issues.listForRepo`, `users.getAuthenticated`. None of these need write. `repo` is full read/write/delete on all the user's private repos, including ability to create deploy keys, force-push, and delete branches. If the PAT leaks (see C2), the blast radius is total. The deep-link is the path of least resistance and most users will accept exactly what's pre-checked.
**Fix:** Change the prefill to `public_repo` for public-only flows, or — for private repos — to a fine-grained PAT with read-only contents/metadata/issues/pull-requests on the specific repo. At minimum drop `read:user` (the user login comes back from `users.getAuthenticated` without that scope) and replace `repo` with a script that links to a fine-grained-PAT page with a doc of which permissions are required. Update the UI copy to match.

### [H3] `GitService.setCwd` accepts arbitrary renderer paths and uses them as `execFile` cwd, with no allowlist, no symlink resolution, and no UNC/network-path filter
**Where:** `src/main/git-service.ts:37-42` (`setCwd`), `:44-76` (`detect`), and IPC entry at `src/main/index.ts:126`.
**Issue:** The check is `fs.existsSync(next)` — no path normalization (`..` is fine), no rejection of UNC paths (`\\attacker-host\share`), no rejection of root drives. `setCwd("\\\\attacker.com\\share")` will succeed if the path exists, and then every `detect()` call shells out `git rev-parse --abbrev-ref HEAD` etc. with that cwd. On Windows, that's a Mark-of-the-Web-bypass-class pattern: causing a privileged binary (git) to operate inside a network-mounted directory can trigger DLL planting if any git plugin / config in that directory is honored. Even without DLL planting, an attacker-controlled `\\share\.git\config` (containing `[core] sshCommand = "powershell ..."`) executes arbitrary code on the next `git fetch`-class operation. Phase 5+ git wrap-ups (push/pull) would make this directly exploitable.
**Fix:** Reject paths matching `^\\\\` on Windows. Resolve to canonical path with `fs.realpathSync(next)`. Optionally maintain an explicit "trusted workspaces" allowlist persisted to userData and require the user to confirm new paths via a one-time dialog (VS Code-style "Trust this workspace"). Set `git -c protocol.file.allow=user -c core.sshCommand=false` consistently, or call `git --no-optional-locks -c safe.directory=...` explicitly.

### [H4] PTY preload listeners never unsubscribe → input/output doubling under StrictMode/HMR/panel toggling
**Where:** `src/preload/preload.ts:6-14, 26-28` (no disposer returned), consumed at `src/renderer/components/terminal/TerminalPanel.tsx:73-87` with `useEffect(() => {...}, [])`.
**Issue:** Each `ipcRenderer.on(...)` registration adds a listener and the preload never removes it. React 19 StrictMode + Vite HMR will re-run the effect at least twice in dev; toggling away from and back to the terminal panel will eventually do so in prod if the component is unmounted/remounted. Each duplicate listener writes the same data to xterm and routes the same `onReady` PID twice — but the dangerous case is `onReady` firing for an old session and overwriting the `claudePid` ResourceMonitor uses, plus `terminal.restart()` being called multiple times for one keypress (`TerminalPanel.tsx:117-127`) which spawns extra `claude.exe` processes.
**Fix:** Change `onData/onExit/onReady/onUpdate` in `preload.ts` to return `() => ipcRenderer.removeListener(channel, handler)` and update the renderer effects to call the disposer in cleanup. Update `src/declarations.d.ts:48-58, 56` types accordingly.

### [H5] `setToken` validates online then persists — disk failure after a successful validation silently loses the token but leaves the in-memory Octokit live
**Where:** `src/main/github-service.ts:44-60`.
**Issue:** `octokit.users.getAuthenticated()` succeeds, `persistToken` writes to disk and may throw (ENOSPC, EPERM, AV quarantine). `writeStore` is called twice in this path (once inside `persistToken` at `:199`, again at `:55` for `lastLogin`/`lastScopes`) — both can throw. If the second one throws after the first succeeded, the on-disk store has the token but no login metadata. If the first one throws, the in-memory `this.octokit` is still assigned at `:57`, so the renderer believes it is connected; next launch, the token is gone and the user sees an unexplained "GitHub token not set" error.
**Fix:** Wrap the persistence in a transaction: write everything to one tmp, rename once. Only after rename succeeds, set `this.octokit` and `this.cachedAuth`. On any thrown error, restore the prior `cachedAuth` and rethrow so the renderer can show "token validated but could not be saved."

## Medium (track as tech debt)

### [M1] Issue label colors interpolated raw into CSS strings
**Where:** `src/renderer/components/github/IssueList.tsx:60-62` (`background: \`#${l.color}20\`` etc.).
**Note:** GitHub's API constrains label color to 6 hex chars, and the mapper at `src/main/github-service.ts:163-167` defaults to `'888888'`. But there is no validation — a future Octokit response shape change, a mocked dev fixture, or a tampered cache could inject CSS like `red;background-image:url(//attacker/)` and exfiltrate via background-image requests (subject to CSP — which today is missing, see C3). Validate with `/^[0-9a-fA-F]{6}$/` in the mapper.

### [M2] No `app.on('web-contents-created')` navigation lockdown
**Where:** `src/main/index.ts` — entirely absent.
**Note:** A `<a href="https://example.com">` accidentally rendered (or injected by a future Markdown component) and clicked would navigate the only window away from the React shell, breaking the app and exposing the renderer to a third-party origin with the preload still attached. Add a `web-contents-created` handler that denies all `window.open` and prevents navigation away from the Vite dev URL / `app://` origin.

### [M3] No timeout on `execFile('git', …)`
**Where:** `src/main/git-service.ts:88-95`.
**Note:** A hung git on a network-mounted repo or while another git process holds an index lock will leave the renderer's `git.detect()` promise pending forever. Combined with the loading-spinner UX in `GitHubPanel.tsx`, the user sees a stuck UI. Add `{ timeout: 5000, killSignal: 'SIGTERM' }` to `execFile` options.

### [M4] CompactController's "is this our hook?" uses substring match
**Where:** `src/main/compact-controller.ts:100-102, 127-129, 149-152` — all use `h.command.includes('compact-controller')`.
**Note:** A user whose unrelated project lives under `~/projects/my-compact-controller/` and added a hook pointing there will see their hook silently deleted on uninstall, or duplicate-blocked on install. Match on the exact script path the controller installed (which the controller knows — it constructs them at `:81-92`).

### [M5] `pty-manager` `child_process` fallback uses `shell: true` with a path candidate that includes bare `'claude'`
**Where:** `src/main/pty-manager.ts:62-68` with `findClaudePath()` at `:111-124`.
**Note:** Today `findClaudePath` returns one of three hardcoded values, none derived from user input. But the `shell: true` + bare-binary-name pattern is a footgun if any future code path lets a user point at a custom Claude binary. Use `shell: false` with an explicit `cmd.exe`/`bash` wrapper if shell features are needed, and never use `shell: true` for arguments that could become user-controlled. Also: this fallback path produces a non-functional terminal (no resize, no real TTY) but emits `ready` as if it were healthy — see journal `src_main_pty-manager_ts.lmm.md` for the silent-degradation argument.

### [M6] `<userData>/github-auth.json` permissions not restricted on Windows
**Where:** `src/main/github-service.ts:221-226`.
**Note:** Even when the token is encrypted, the surrounding metadata (`lastLogin`, `lastScopes`) and the encrypted blob itself sit in a file with default ACLs — readable by any process running as the user, and on multi-user machines potentially by Administrators. After `fs.renameSync(tmp, this.storePath)`, set restrictive ACLs via `fs.chmod` (POSIX) and `icacls` or a `node-windows`-style call (Windows).

### [M7] `commentCount: 0` hardcoded for PRs is a UI lie
**Where:** `src/main/github-service.ts:139`.
**Note:** Not security, but a correctness claim the UI displays (`💬 0` shown next to PRs that have hundreds of comments). Either fetch real counts or remove the field from `GitHubPullRequest` until accurate.

### [M8] `ElectronAPI` declared in three places, with the `shared/types.ts` copy now stale
**Where:** `src/shared/types.ts:119-127` (only has `terminal` namespace, missing `resources`, `compact`, `git`, `github`, `window`).
**Note:** Currently inert (the renderer types come from `src/declarations.d.ts:45-109`). But "declared but unused" means a future refactor could delete `declarations.d.ts` thinking it's stale, falling back to the broken stub — and the renderer would compile against a tiny subset of the real surface. Delete the stale `ElectronAPI` from `shared/types.ts` and add a `// see src/declarations.d.ts` comment.

## Low / nits

- `src/preload/preload.ts:69-71` uses bare `'window:minimize'`/`'window:maximize'`/`'window:close'` strings instead of `IPC.*` constants — breaks the single-source-of-truth pattern.
- `src/main/index.ts:201-207` calls `ptyManager.kill()` + `resourceMonitor.stop()` in `window-all-closed` even though the window `close` handler at `:44-47` already did. Duplicate-tear-down is benign but obscures lifecycle.
- `src/main/index.ts:194-198` recreates the window on macOS `activate` after services were torn down in `window-all-closed` — reopening on Mac yields a window with dead services. Latent bug.
- `safeSend` (`src/main/index.ts:66-70`) assumes a single window; Phase 7 split-panes will need per-`WebContents` routing.
- `src/main/github-service.ts:105-117` makes two API calls (`listBranches` + `repos.get`) just to flag `isDefault`. Cache `defaultBranch` per `(owner, repo)`.
- `src/main/resource-monitor.ts:85-87` swallows poll errors with no logging — silent telemetry gaps.
- `src/main/pty-manager.ts:102-109` `kill()` is fire-and-forget with no SIGKILL escalation; can hang shutdown.
- `forge.config.ts:41-47` sets 4 fuses but omits `OnlyLoadAppFromAsar: true` and `EnableEmbeddedAsarIntegrityValidation: true` — both cheap tamper-resistance for packaged builds.
- `package.json:38-55` does not declare `engines.node` or `os`; postinstall `scripts/patch-node-pty.js` assumes Windows and VS Build Tools without enforcement.
- `HANDOFF.md` per LMM journal is dated today but content is stale — fix or delete to prevent it from misleading future contributors.

## Out of scope but worth noting

- **OAuth Device Flow** would let the user avoid pasting PATs entirely and lets the app request granular per-repo scopes. Worth planning before Phase 5 accretes more PAT-bound code.
- **Auto-update path** is not yet wired (no `update-electron-app` or Squirrel update URL in `forge.config.ts`); when added, ensure update signatures are verified — Squirrel.Windows does not by default.
- **Telemetry / crash reporting**: none today, which is the right default. If added, make sure crash dumps strip `github-auth.json` and `~/.claude/settings.json` contents.
- **Supply chain**: `@octokit/rest`, `react`, `vite`, `electron` are all maintained and pinned to recent majors. The one custom thing — `scripts/patch-node-pty.js` running at postinstall — patches `node_modules/node-pty` files via regex without a version pin; a future node-pty release that changes the gyp shape will silently leave files unpatched. Add a `node-pty` version assertion at the top of the script.
- **`electron-store@^11`** is ESM-only; the main bundle is CJS-shaped output of Vite's main config. Currently the dep is `external`'d but unused in the code I read — confirm before shipping that no `require('electron-store')` call path exists, or migrate to dynamic `import()`.
