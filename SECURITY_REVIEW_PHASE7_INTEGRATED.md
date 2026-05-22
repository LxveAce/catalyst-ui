# Phase 7-Integrated Cross-Feature Security Review

Scope: integration-introduced defects on branch `phase-7-integrated`
(commits `aab67b5..c26e273`). Per-phase findings already captured in
`SECURITY_REVIEW_PHASE7{A..E}.md` are intentionally NOT repeated.

## Summary
12 cross-cutting integration concerns examined. Found **1 High** (broken
persistence of new panel), **3 Medium**, and **3 Low** issues. No
Critical (no integration-introduced exploit or data-loss on default
config). All four notification kinds verified end-to-end. PTY restart
suppression verified across every restart path. Tray + updater + multi-pane
shutdown paths verified to converge correctly on `before-quit`.

---

## Critical
(none)

---

## High

### H1 — `cost` panel never persists across restart (SessionService allowlist not extended)
- `src/main/session-service.ts:18-28` — `VALID_PANEL_IDS` Set lists the 9
  panel ids from before 7e: `terminal, commands, resources, github,
  compact, lmm, sync, auth, settings`.
- `src/shared/types.ts:366-376` — Phase 7e added `'cost'` to
  `SessionPanelId`, and `src/renderer/App.tsx:30-40` mirrors it in
  `SidebarPanel`.
- Effect: when `activePanel === 'cost'` is round-tripped through
  `session-service.ts:85-88`, `VALID_PANEL_IDS.has('cost')` is false and
  the sanitizer coerces it back to `'terminal'`. User opens Cost panel,
  closes app, relaunches — silently dropped to Terminal. The 7e panel is
  fully functional in-session; only persistence is broken.
- Fix: add `'cost'` to `VALID_PANEL_IDS`. One-line change. No data
  migration needed — old session files coerce as today.

---

## Medium

### M1 — `bindings` empty until async fetch resolves; integrated hotkey listener has a no-op window
- `src/renderer/App.tsx:55` initializes `useState<HotkeyBinding[]>([])`.
- `src/renderer/App.tsx:274-288` builds the chord map from `bindings`;
  when empty, the effect short-circuits (`chordMap.size === 0 → return`).
- Between window load and the `hotkeys.get()` IPC roundtrip resolving
  (App.tsx:245-262), there is a brief window in which NO hotkey works,
  including Ctrl+Shift+P. On a cold start with a busy main process
  (cost sampling kicks immediately at `index.ts:453`, updater wired at
  +5s), this can be perceptibly long. Default state is reasonable so the
  fix is to seed with `DEFAULT_BINDINGS` from `hotkeys-service.ts:24-30`,
  duplicated to the renderer, and overwrite on `hotkeys.get()` resolve.

### M2 — Tray restart on hide-window keeps PTYs alive but cost-sampling continues to read `state.json` with the renderer offline
- `src/main/cost-service.ts:118-129` keeps the 30 s polling loop running
  unconditionally after `getCost().start()` in `setupCost`.
- `src/main/index.ts:166-177` — when minimize-to-tray hides the window,
  PTYs survive (correct) and so does the cost sampler. The sampler reads
  `~/.claude/compact-controller/state.json` which is written by the
  compact-controller hook that the PTYs trigger; nothing new.
- However, the budget-exceeded notification (cost → notifications) WILL
  fire while the window is hidden, even though the user isn't actively
  in a session. That's the intended behavior of the toggle, but combined
  with the auto-updater's `notifyUpdateAvailable` (both can fire while
  hidden), a user who minimizes-to-tray and walks away can return to two
  unread toasts they never opted into receiving in tandem. Recommend
  documenting this in the Settings tray-section helper text.

### M3 — `dispatchTrayAction` is dead code; tray menu cannot reach renderer-side actions
- `src/main/index.ts:546-552` declares `dispatchTrayAction(action)` that
  forwards to `IPC.TRAY_INVOKE_ACTION`, then immediately swallows
  with `void dispatchTrayAction;` to dodge the unused-var lint.
- `src/main/tray-service.ts:138-163` `rebuildMenu()` only wires
  "Show Window", "Toggle compact controller", and "Quit" — none of these
  reach `dispatchTrayAction`.
- `src/renderer/App.tsx:264-270` subscribes to `tray.onInvokeAction` but
  nothing on the main side ever fires it. The wiring is plumbed end-to-end
  but never exercised. Not a bug per se (intentional forward-compat hook
  with a `// future tray menu growth` comment) but reviewers should know
  the renderer subscription cannot be assumed to be a tested path.

---

## Low

### L1 — `'compact.toggle'` hotkey label vs behavior drift between tray and hotkey paths
- `src/renderer/hotkeys.ts:101-105` and `src/main/hotkeys-service.ts:16-22`
  define an action labeled "Toggle compact controller".
- `src/main/tray-service.ts:146-153` "Toggle compact controller" tray
  menu item correctly install/uninstalls via `onToggleCompact` callback
  → `compactController.install()/uninstall()` in `index.ts:521-534`.
- `src/renderer/App.tsx:226-227` hotkey dispatch for `'compact.toggle'`
  just runs `setActivePanel('compact')` — opens the panel, does NOT
  install/uninstall. Same label, different effect depending on entry
  point. Recommend renaming the hotkey action to `'panel.compact'` for
  parity with `'panel.lmm'` / `'panel.github'`.

### L2 — Cost-budget notification re-fires after `resetHistory` if today already exceeds budget
- `src/main/cost-service.ts:181-188` `resetHistory()` zeros
  `lastBudgetAlertDate`.
- `src/main/index.ts:442-450` `COST_RESET_HISTORY` handler calls
  `resetHistory()` then `sampleNow()`.
- `cost-service.ts:426-440` `maybeFireBudgetAlert` checks
  `lastBudgetAlertDate !== today`. After reset it's null → if the new
  sample brings today back over budget, the notification fires AGAIN
  the same day. Probably fine (it's a user-initiated reset) but worth
  noting.

### L3 — Pre-quit PTY exits will fire `notifyPtyExit` for every pane (throttled to one toast)
- `src/main/index.ts:619-623` `before-quit` calls `ptyRegistry.killAll()`.
- `pty-registry.ts:144-148` iterates each pane → emits 'exit' → 
  `index.ts:211-223` fires `notifyPtyExit` unless suppressed.
- 7d's tray-quit (`isQuitting=true; app.quit()`) flows through here. The
  multi-pane addition from 7c means with N panes open the user gets up to
  N exit notifications, BUT `NotificationsService.show()` per-kind
  throttle (`notifications-service.ts:8` `MIN_INTERVAL_MS = 1000`) caps
  to one. Same behavior existed pre-integration, just with N=1; reporting
  for awareness — consider adding a global suppression flag set in
  `before-quit` so quitting never surfaces a "Claude exited" toast.

---

## Verified-OK

### Notification kinds (item 1)
All four toggles wired end-to-end:
- `notifyOnPtyExit`: `notifications-service.ts:80-86` ← fired from
  `index.ts:218-222` (PTY exit handler).
- `notifyOnSyncError`: `notifications-service.ts:88-94` ← fired from
  `cloud-sync.ts:362-368` via the `onSyncError` callback wired in
  `index.ts:65-76`.
- `notifyOnUpdateAvailable`: `notifications-service.ts:96-111` ← fired
  from `index.ts:102-109` `onUpdateDownloaded` callback.
- `notifyOnCostBudget`: `notifications-service.ts:113-122` ← fired from
  `cost-service.ts:426-440` via the `onBudgetExceeded` callback wired in
  `index.ts:136-147`.
Each toggle has a matching `ToggleRow` at `SettingsPanel.tsx:328-356`
and a matching disk-read default in `notifications-service.ts:174-191`.

### Service singleton ordering (item 2)
All 11 services are lazy-initialized via `get*()` getters
(`index.ts:50-147`). Cross-references go through the getters
(`cloud-sync → getNotifications()`, `updater → getNotifications()`,
`cost → getNotifications()`), so even if a notification fires before
the user has opened that panel, the notifications service is
constructed on first call. `PtyRegistry` / `ResourceMonitor` /
`CompactController` / `GitService` are eager `new`'d at module load,
which is fine — they don't depend on any other service.

### PTY lifecycle: tray + update-pending + multi-pane (item 3)
- Window-hide (tray): `index.ts:166-174` `preventDefault + hide`. PTYs
  survive because `kill` is not called.
- Auto-updater download: we never call `autoUpdater.quitAndInstall()`
  (`update-electron-app` is started with `notifyUser: false`), so updates
  apply on the next natural relaunch. No PTY interaction.
- Real quit (tray-Quit, window-X without tray, app.quit()): `before-quit`
  at `index.ts:611-634` calls `ptyRegistry.killAll()` exactly once.
  Idempotent.
- Multi-pane: `pty-registry.ts:144-148` iterates the full Map. No leak.

### `suppressedRestartPanes` semantics (item 4)
Single restart write site at `index.ts:247-265` (`TERMINAL_RESTART`
handler). Three call sites all flow through it:
- `App.tsx:147-149` palette-driven `handleRestartTerminal`.
- `App.tsx:223-225` hotkey dispatch `'terminal.restart'`.
- `TerminalPanel.tsx:179-184` press-any-key on dead pane.
All pass the correct `paneId`. The Set is the only suppression source
(7d's single-boolean `suppressNextPtyExitNotification` is fully removed
from `index.ts`).

### Session round-trip with `activePanel: 'cost'` (item 5)
BROKEN — see H1 above. All other panel ids round-trip correctly.

### Hotkey actions vs palette actions (item 6)
`HotkeyAction` (5): `palette.open, terminal.restart, compact.toggle,
panel.lmm, panel.github`. Each has a `case` in `App.tsx:217-241`
`dispatchAction`. No orphans. Palette has 12 actions (6 panes from 7c, 2
from 7e: cost-reset + notification-test, plus 7a's snippets and
terminal-restart) — palette doesn't share an enum with hotkeys, so
nothing to mismatch.

### `terminal.restart()` callers all pass paneId (item 7)
`grep terminal\.restart\(`:
- `App.tsx:148, 224` pass `activePaneId`.
- `TerminalPanel.tsx:180` passes `paneId` (the local prop).
Preload `restart` is `(paneId: string) => ipcRenderer.send(...)` — no
default. Main handler `index.ts:247` rejects invalid ids via
`PtyRegistry.isValidPaneId`. No callers without paneId remain.

### `onAvailable` unsubscribe (item 8)
- `SettingsPanel.tsx:77-94` captures `unsub = onAvailable(...)`, calls
  `unsub()` inside the cleanup function. Empty dep array → cleanup runs
  on unmount, not on every render.
- `StatusBar.tsx:22-32` mirrors the same pattern.
Both correct; no listener leak.

### Cost service start vs updater deferred start (item 9)
- `getCost().start()` runs synchronously at `index.ts:453` inside
  `setupCost()` during `app.whenReady`.
- `getUpdater().start()` runs at +5s via `setTimeout` at `index.ts:593-599`.
They share no resource. Cost timer is `unref()`-ed
(`cost-service.ts:126-128`) so it doesn't block app exit. The
notifications callback wiring for both happens at lazy-getter time, so
order doesn't matter.

### Tray minimize + window-all-closed (item 10)
- `index.ts:166-177`: `preventDefault + hide()` keeps the BrowserWindow
  alive (just hidden). `window-all-closed` does not fire because
  `BrowserWindow.getAllWindows().length === 1`.
- `index.ts:636-643`: when it DOES fire (real close on non-darwin,
  non-tray path), calls `app.quit()` → `before-quit` → teardown.
- Re-entry: `app.on('activate')` at `index.ts:601-608` shows+focuses on
  macOS dock click; tray-click on Windows/Linux flows through
  `tray-service.ts:165-171` `showWindow()`. Both restore the same hidden
  window.

### `package.json` / `forge.config.ts` plugin ordering (item 11)
- `package.json:49` `@electron-forge/publisher-github` in devDependencies.
- `package.json:38` `update-electron-app` in dependencies (correct —
  runtime).
- `forge.config.ts:50-70` `publishers` is its own array, independent of
  `plugins` (lines 71-100). `AutoUnpackNatives → VitePlugin → FusesPlugin`
  order matches forge convention; publisher-github does not interact with
  plugins at config time.

### `.gitignore` + `.claude/worktrees/` (item 12)
- `.gitignore` lists `node_modules/, .vite/, out/, .claude/worktrees/`.
- `grep -r '.claude/worktrees'` in `src/` and `scripts/`: zero matches.
- No tracked path depends on the ignored dir.
