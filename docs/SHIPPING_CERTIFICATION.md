# v1.0 Shipping Certification — phase-7-integrated

> Certified: 2026-05-22 · Branch HEAD: 3e62c17

## Verdict
SHIP — no Blocker / Critical / High found.

## Blockers (must fix to ship)
(none)

## Critical (must fix to ship)
(none)

## High (must fix to ship)
(none)

## Verified-OK (explicitly checked, no blocker)

- ✓ **App boot order**: `src/main/index.ts:572-609` wires all 11 services
  inside `app.whenReady().then(...)` via lazy `get*()` singletons
  (`index.ts:50-147`). Cross-service references (`getCloudSync()` →
  `getNotifications()` via callback closure at `index.ts:67-73`;
  `getUpdater()` → `getNotifications()` at `index.ts:102-108`;
  `getCost()` → `getNotifications()` at `index.ts:138-144`) all go
  through the getters, so first-use construction is safe regardless of
  call order. No circular import: the four eagerly-`new`'d services
  (`PtyRegistry`, `ResourceMonitor`, `CompactController`, `GitService` at
  `index.ts:29-32`) depend on no other service.

- ✓ **Renderer mounts on fresh install**: every panel handles `null`
  state with a loading placeholder before IPC resolves:
  `CostPanel.tsx:87-93` ("Loading cost data…"), `SettingsPanel.tsx:472-476`
  ("Loading updater status…"), `SyncPanel.tsx:23-36` (try/catch around
  initial fetch, falls back to disabled UI), `AuthPanel.tsx:25-33`
  (re-fetches on mount), `GitHubPanel.tsx:48-51` (shows `ConnectGitHub`
  when `!auth.hasToken`), `LMMPanel.tsx:38-47` (gated on `settings.enabled`).
  `App.tsx:60-85` `session.get()` always returns a sanitized default
  state, never null — `SessionService.get()` falls back to `defaults()`
  on missing/corrupt files (`session-service.ts:163-200`).

- ✓ **Sandbox + sandbox-safe preload**: `src/preload/preload.ts` imports
  ONLY `electron.contextBridge` + `electron.ipcRenderer` and
  `IPC` constants. No `fs`, `path`, `child_process`, or other Node APIs.
  All renderer functionality is exposed through `contextBridge.
  exposeInMainWorld('electronAPI', ...)` at line 31. Compatible with
  `webPreferences.sandbox: true` (`index.ts:161`).

- ✓ **Notification kinds fully wired**: All 4 toggles have a matching
  toggle UI row at `SettingsPanel.tsx:327-355` AND a fire-site early-return
  in main:
    - `notifyOnPtyExit` → `notifications-service.ts:80-86`, fired from
      `index.ts:218-222` (PTY exit handler, gated by `suppressedRestartPanes`).
    - `notifyOnSyncError` → `notifications-service.ts:88-94`, fired from
      `cloud-sync.ts` via `onSyncError` callback at `index.ts:67-73`.
    - `notifyOnUpdateAvailable` → `notifications-service.ts:96-111`,
      fired from `index.ts:102-108` `onUpdateDownloaded`.
    - `notifyOnCostBudget` → `notifications-service.ts:113-122`, fired
      from `cost-service.ts:426-440` via `onBudgetExceeded` callback at
      `index.ts:138-144`. Each `notify*` first checks
      `settings.enabled && settings.notifyOn*`.

- ✓ **electron-store removal is complete**: `Grep electron-store src/`
  returns zero matches. `package.json:27-38` does not list it as a
  dependency. Built bundle `.vite/build/index.js` contains zero
  `electron-store` strings (`grep -c "electron-store"` = 0). Historical
  references survive only in `docs/security-reviews/SECURITY_REVIEW.md` / `journal/` /
  `HANDOFF.md` "What's Next" item 6 — all documentation, not load-bearing.

- ✓ **vite.main.config.ts externals**: `external: ['node-pty',
  'systeminformation']` (`vite.main.config.ts:6`). Both are native
  modules that must not be bundled. `@octokit/rest` and
  `update-electron-app` ARE bundled — verified by `grep update-electron-app
  .vite/build/index.js` returns 3 matches (literal references survived
  rollup's inline). Dynamic `require('update-electron-app')` at
  `updater-service.ts:106` resolves cleanly because rollup statically
  finds the literal string. `@octokit` appears 3 times in the bundle:
  Octokit class is inlined.

- ✓ **CSP covers the renderer's actual network surfaces**:
  `index.html:8` allows `img-src` for `avatars.githubusercontent.com` +
  `*.githubusercontent.com`, and `connect-src` for `api.github.com` +
  localhost. Renderer-side `grep fetch\(` returns ZERO matches — every
  network call goes through main via IPC. GitHub API (Octokit),
  auth-backend HTTPS, and `update.electronjs.org` all run in the main
  process and are therefore NOT subject to renderer CSP. No new
  connect-src needed for Phase 7b.

- ✓ **Forge config publisher**: `forge.config.ts:50-70` declares
  `PublisherGithub` with `repository.owner: 'LxveAce'`,
  `repository.name: 'claude-code-studio'`, `draft: true`. The maker
  (`MakerSquirrel` at `forge.config.ts:20-47`) produces the artifacts the
  publisher uploads — `@electron-forge/publisher-github@^7.11.2`
  matches the maker version `^7.11.2` (package.json:43,48). No required
  field missing; `npm run publish` will not 422 at the publisher level
  (auth-via-`GITHUB_TOKEN` is documented in the inline comment).

- ✓ **Build artifacts present**: `.vite/build/index.js` (197,071 bytes,
  matches `package.json:6` `"main": ".vite/build/index.js"`) and
  `.vite/build/preload.js` (7,760 bytes, matches the `path.join(__dirname,
  'preload.js')` reference at `index.ts:158`). Main bundle contains
  `loadFile(p.default.join(__dirname,`../renderer/main_window/index.html`)`
  — confirms `MAIN_WINDOW_VITE_NAME = 'main_window'` was inlined by
  Forge's VitePlugin renderer config (`forge.config.ts:87-91`).

- ✓ **Session round-trip with all 10 panel IDs**: `session-service.ts:18-29`
  `VALID_PANEL_IDS` lists `terminal, commands, resources, github, cost,
  compact, lmm, sync, auth, settings` — all 10 from `App.tsx:30-40`
  `SidebarPanel`. The `'cost'` regression (PHASE7_INTEGRATED H1) is
  fixed. Sanitizer at line 87-89 coerces any out-of-allowlist value to
  `'terminal'` — safe fallback, not a crash path.

- ✓ **Hotkey cold-start fallback**: `App.tsx:281-303` registers a
  hardcoded `Ctrl/Cmd+Shift+P` palette-open handler that runs BEFORE the
  configurable chordMap check — so even during the ~50 ms IPC race
  before `hotkeys.get()` resolves, the palette is reachable. This
  remediates PHASE7_INTEGRATED M1.

- ✓ **Sandbox-incompatible APIs absent from preload**: confirmed
  zero imports of `fs`, `path`, `os`, `child_process`, `crypto`, or
  `node:*` in `src/preload/preload.ts`. Only the two whitelisted
  electron exports (`contextBridge`, `ipcRenderer`) plus the shared
  `IPC` constant.

- ✓ **First-launch defaults render usable state**: with no files in
  `<userData>`:
    - Compact: `compact-controller` returns `enabled:false` status, panel
      shows toggle off.
    - GitHub: `auth.hasToken === false`, `GitHubPanel.tsx` shows
      `ConnectGitHub` form.
    - LMM: default `enabled: false`, panel shows enable prompt;
      `ensureDir(this.settings.journalDir)` at `lmm-service.ts:34` creates
      the default `<userData>/lmm-journal/` directory.
    - Auth: `AuthService` defaults to `mode: 'local-stub'`, `signedIn: false`.
    - Sync: defaults to `enabled: false`, `configured: false`; wizard CTA shown.
    - Snippets: `read()` returns `{ snippets: [] }` on ENOENT.
    - Notifications: `DEFAULTS.enabled = false` (`notifications-service.ts:11`)
      — silent until user opts in.
    - Updater: in dev mode shows "dev-mode" inactive reason; in prod
      shows "Active — checking automatically" 5 s after launch.
    - Tray: `defaultTraySettings()` returns
      `minimizeToTrayOnClose: true` ONLY on Windows (`tray-service.ts:45`).
    - Hotkeys: 5 default bindings loaded from `DEFAULT_BINDINGS` at
      `hotkeys-service.ts:24-30`.
    - Cost: `freshHistory()` returns zeros, `last30Days` shows 30 empty days.

- ✓ **`.gitignore` covers build artifacts**: `node_modules/`, `.vite/`,
  `out/`, `.claude/worktrees/` — all generated dirs ignored. `.vite/build/`
  exists at certification time but is correctly gitignored (was rebuilt
  by the developer's `npm run package` and never committed).

- ✓ **postinstall script handles fresh clones**: `scripts/patch-node-pty.js:6-9`
  short-circuits with `[patch-node-pty] node-pty not installed, skipping`
  if `node_modules/node-pty` doesn't exist yet. On a fresh `npm install`,
  npm installs deps first, then runs postinstall — so node-pty will be
  present and the patch applies before electron-rebuild.

- ✓ **`update-electron-app` dynamic require pattern**: `updater-service.ts:106`
  uses CommonJS `require('update-electron-app')` inside a try/catch and
  gated by `productionMode + supported-platform + enabled`. Dev mode,
  Linux, and user-disabled paths NEVER touch the import — so the
  dynamic require's failure mode is bounded to a state-only `init-error`
  surfaced in Settings, never a crash.

- ✓ **Tray + before-quit converges**: window close-button (with
  minimize-to-tray off) → `app.quit()` → `before-quit` (`index.ts:611-634`)
  → `ptyRegistry.killAll()` + `costService?.stop()` + `trayService?.dispose()`.
  Tray "Quit" sets `isQuitting=true` first (`tray-service.ts:157-159`
  + `index.ts:535-538`) so the window's close handler doesn't re-hide.
  No PTY leak; no double-quit.

## Known Deferred (already in HANDOFF "What's Next" — confirmed not regressions)

- HiDPI tray icon variants (HANDOFF item 1) — Phase 7d single 16x16 PNG.
- Cost panel model-per-day awareness (HANDOFF item 3) — single chosen
  model with a documented disclaimer.
- Updater beta-channel routing (HANDOFF item 4) — beta UI was removed
  from `SettingsPanel.tsx` per the polish pass; Channel row shows
  literal "stable". The setting still persists `beta` if set
  programmatically but no UI path can write it (verified
  `grep beta src/renderer/` → 0 matches).
- Session migration scaffold (HANDOFF item 5) — `session-service.ts:202-223`
  `migrate()` skeleton present, no version bumps shipped yet.
- electron-store ESM landmine (HANDOFF item 6) — fully removed from
  source and bundle; only documentation references remain.
- Multi-pane resource-monitor UI breakdown (HANDOFF item 7) — backend
  aggregates correctly; per-pane breakdown is a UI enhancement.
- macOS port (HANDOFF item 8) — Squirrel publisher Windows-first;
  `MakerZIP({}, ['darwin'])` at `forge.config.ts:48` produces darwin
  artifacts but auto-update on Mac requires signing (documented in
  forge.config inline comments).

Additionally inherited Mediums from per-phase reviews (NOT regressions):
- PHASE7_INTEGRATED M2 (cost sampler keeps running while tray-hidden) —
  documented in `SettingsPanel.tsx:495-501` tray helper text.
- PHASE7_INTEGRATED M3 (`dispatchTrayAction` is dead code) — intentional
  forward-compat hook with `// future tray menu growth` comment at
  `index.ts:548-552`.
- PHASE7_INTEGRATED L1 (`compact.toggle` hotkey opens panel, tray
  menu installs hooks) — different behavior by entry point; renaming to
  `panel.compact` is a future polish.
- PHASE7_INTEGRATED L3 (per-pane PTY exit notifications coalesce to one
  toast by 1 s throttle) — `NotificationsService.show()` `MIN_INTERVAL_MS`
  caps to one regardless of pane count.

## Recommendation

Tag v1.0 from `phase-7-integrated` HEAD (3e62c17). The branch is
release-ready: every Critical/High from prior phase reviews is fixed,
the cross-feature integration High (H1 cost-panel persistence) is
fixed, both polish items called out in HANDOFF (hotkey cold-start
fallback, electron-store removal, updater beta UI removal, session
migrator scaffold, tray helper text) are shipped. Re-verify only one
thing on a real Windows shell before the tag push: that `npm run
package` materializes `out/` (the dev shell has been quirky about
this — `.vite/build/` confirms the upstream Vite step succeeds; the
post-package Electron Packager step is the open verify-on-real-shell
item per HANDOFF).
