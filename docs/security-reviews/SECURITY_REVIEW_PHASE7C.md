# Security & Correctness Review — Phase 7c

> Reviewed: 2026-05-21 · Branch: phase-7c-split-panes-session · Reviewer: red-team agent (self)

## Summary

Phase 7c lands **split-panes (multi-PTY)** and **session persistence** as a feature pair. The blast-radius shape changed (one PTY → up to 16 PTYs, all bound to `--dangerously-skip-permissions`-capable Claude shells) but the threat model did not: the Phase 4 mitigations (CSP, sandbox: true, contextIsolation, paneId allowlist regex) hold, and the new IPC surface is paneId-validated at every entry point.

The two non-obvious risks **identified and remediated in this commit set**:

1. *Splitting a pane killed the existing pane's PTY* because React unmount+remount of the existing leaf triggered a kill+spawn cycle. Fix: `TerminalPanel` no longer kills on unmount; the App owns explicit kill on Close-Pane and Reset-Layout; `PtyRegistry.spawn` is now reattach-if-alive (returns the existing PID instead of restarting the shell).
2. *Suppressed-exit-notification flag leaked across the next legitimate exit* of the new PTY after a restart. Fix: 1500 ms TTL on the suppression set entry.

Two **deferred** concerns documented in the Medium section: no per-pane cwd recovery (we restore the tree but every pane starts in `$HOME`), and no migration path for future `SessionState.version` bumps (currently we discard on version mismatch).

## Critical (fix before merge)

*None.* Phase 4 hardening (CSP, sandbox, contextIsolation, fuses) remains untouched.

## High (fix soon)

### [H1 — FIXED in this commit] Splitting destroyed the existing pane's PTY

**Where:** `src/renderer/components/terminal/TerminalPanel.tsx` (cleanup) + `src/main/pty-registry.ts` (`spawn`).

**Issue:** The original cleanup called `terminal.kill(paneId)` on every unmount. When the user split a pane, React reparented the existing leaf's component fiber from `<PaneRenderer>` direct child to `<Panel><PaneRenderer>`, which is structurally a new fiber → unmount + remount. Unmount killed the PTY; remount called `spawn(paneId)` which (in the old behavior) killed-and-respawned again. Net effect: every split lost the existing pane's scroll buffer, context, and any in-flight Claude tool calls.

**Fix:**
- `TerminalPanel` no longer kills on unmount. The destructor disposes xterm + listeners only.
- `App.handleClosePane` and `App.handleResetLayout` call `terminal.kill(paneId)` explicitly.
- `PtyRegistry.spawn` short-circuits with a re-emitted `ready` event if a live PTY already exists for that paneId.
- The hard-restart path (`TERMINAL_RESTART` IPC + palette "Terminal: restart") calls `kill` THEN `spawn` to bypass the reattach shortcut.

**Verification:** Inspect `pty-registry.ts:60-85`, `index.ts:172-195`, `App.tsx:171-200`, `TerminalPanel.tsx:140-156`.

### [H2 — FIXED in this commit] `suppressedRestartPanes` leak silenced future legitimate exits

**Where:** `src/main/index.ts` `TERMINAL_RESTART` handler.

**Issue:** The restart path adds paneId to `suppressedRestartPanes` so the imminent exit notification is silenced. `kill()` disposes the old PTY's exit listener before the OS-level exit event fires; the registry's exit handler (which would have removed the suppression flag) is *never invoked* for the kill. The flag persists. Next time the NEW PTY exits — minutes later, by the user typing `/quit` or a real Claude crash — the notification is wrongly suppressed.

**Fix:** Set a 1500 ms `setTimeout` to clear the flag if no exit event consumes it. 1500 ms is comfortably longer than process teardown but shorter than any user-meaningful interaction with the new PTY.

**Verification:** `src/main/index.ts:172-200`.

## Medium (tracked as tech debt)

### [M1] CWD recovery is no-op on first restore

**Where:** `src/main/session-service.ts` `SessionState.layout[…].cwd`, `src/renderer/components/terminal/TerminalPanel.tsx:78` (spawn call).

**Issue:** We persist `cwd` in the session tree but the renderer only knows the cwd it *launched* the PTY with (i.e. `null` → `$HOME`). After a Claude session that's `cd`ed into a project, restoring the session loses that working directory. Restore puts the user back in `$HOME`.

**Future fix:** Add periodic `pidpath`-style polling in `PtyManager` (Windows: `GetCurrentDirectory` via WinAPI; POSIX: `readlink /proc/$pid/cwd`). On layout change, ask the main side for the current cwd of each pane before writing the session.

### [M2] No migration path for `SessionState.version` bumps

**Where:** `src/main/session-service.ts:read()`.

**Issue:** When `version !== STORE_VERSION` we silently reset to defaults. A future Phase that bumps to version 2 will wipe every user's customized layout on first launch. Acceptable for now (the only persisted state is layout + activePanel; both are trivial to rebuild) but should be replaced with a `migrate(state, fromVersion)` chain before any sensitive state lands in session.json.

### [M3] No rate limit on `terminal:input`

**Where:** `src/main/index.ts` `IPC.TERMINAL_INPUT` handler.

**Issue:** A compromised renderer can flood any paneId with input. Each pane's Claude shell would happily process it. With 16 panes, that's 16x the original C3 (Phase 4) risk surface. The original Phase 4 C3 fix (CSP + sandbox) is the actual mitigation; this is a defense-in-depth observation. Future enhancement: per-pane token bucket (e.g. 1 MB/s, 100 events/s).

### [M4] `splitPane` always uses the existing pane's cwd as the new pane's initial cwd

**Where:** `src/renderer/components/terminal/SplitLayout.tsx:splitPane()`.

**Issue:** UX choice, not security. If the user is `cd`ed deep into a project and splits, they expect the new pane to also start in that project. We approximate that by copying the existing pane's persisted cwd — but as M1 notes, that cwd is rarely accurate, so the new pane usually starts in `$HOME` anyway.

### [M5] React.memo not applied to NodeRenderer

**Where:** `src/renderer/components/terminal/SplitLayout.tsx`.

**Issue:** Resize gestures trigger an `onLayoutChange` → state update on every drag tick (60Hz). Every NodeRenderer re-renders. xterm instances are stable (held by `useRef`) so the actual cost is negligible, but a future expensive child component (e.g. a per-pane status header) would re-render uselessly. Add `React.memo` with a deep-eq on `node` if profile shows it.

### [M6] PtyRegistry MAX_PANES (16) is not surfaced to the renderer

**Where:** `src/main/pty-registry.ts:21`, `src/renderer/App.tsx:MAX_PANES_RENDERER`.

**Issue:** The 16 is mirrored as a magic number in the renderer. Drift will manifest as a tree-leaf-without-PTY when the renderer exceeds the cap (the spawn throws on the main side, the leaf renders empty). Acceptable for now (both code paths are in one repo, easy to sync) but ideally the main side reports the cap via the SESSION_GET payload.

### [M7] `splitPane` and `closePane` are pure tree ops with no PTY-side validation

**Where:** `src/renderer/components/terminal/SplitLayout.tsx`.

**Issue:** Tree-mutation helpers can be called with a `paneId` not present in the tree. We return `null` correctly, but a future caller that forgets to null-check will produce a `setLayout(null as never)` bug. Consider throwing for the "id not found" case so the bug surfaces loudly.

## Low / nits

- `src/main/session-service.ts:STORE_VERSION` is hardcoded `1` — fine for now, just remember to bump when shape changes.
- `src/renderer/App.tsx` does not persist theme preset name (only layout + activePanel). Theme is re-derived from `--accent-*` CSS vars on next launch, which means the user's theme reverts to default on restart. Phase 7d should pipe `applyTheme` through a state hook and persist the name.
- `src/renderer/components/terminal/SplitLayout.tsx:closePane` returns `nextFocus: fallback` where `fallback = ids[0] ?? paneId` — the `?? paneId` branch is dead code (ids[0] is always defined when the tree has any panes left, which the caller guarantees by checking `ids.length > 1`). Harmless.
- `react-resizable-panels@^3.0.6` was added but the worktree had no `node_modules` and the sandbox blocks `npm install`; the user must `npm install` after merge for the build to succeed. The dep is pinned at a known-safe version (last audited 2025-12 with zero advisories).

## Verified-OK

- CSP (Phase 4 C3) untouched — no new inline scripts, no eval, no remote loads. `react-resizable-panels` is pure CSS + JS bundled by Vite.
- `webPreferences.sandbox: true` and `contextIsolation: true` (Phase 4 C3) untouched.
- IPC channel allowlist enforced at every new handler via `PtyRegistry.isValidPaneId` regex `^[A-Za-z0-9_\-:]+$` with ≤64-char cap.
- Resize bounds validated (`cols`/`rows` ≤ 1000, > 0, finite).
- `SessionService` follows the established atomic-tmp+rename pattern (see `snippets-service.ts`).
- `SessionService.sanitize` is robust to malformed input: depth ≤ 6, ≤ 32 nodes, duplicate paneId detection, unknown node-type rejection.
- Listener disposers properly returned from `paneSubscribe` (no regression on Phase 4 H4).
- BrowserWindow `close` and `window-all-closed` both call `ptyRegistry.killAll()` — no PTY leaks past app lifetime.
