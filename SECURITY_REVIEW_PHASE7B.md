# Security & Correctness Review — Phase 7b (Auto-update wiring + Windows installer prep)

> Reviewed: 2026-05-21 · Branch: phase-7b-auto-updater · Reviewer: self red-team

## Summary

Phase 7b wires `update-electron-app` to Electron's built-in Squirrel-based
`autoUpdater`, adds a GitHub Releases publisher, exposes IPC for renderer
visibility (last-checked, pending version, channel), surfaces "Update
available" via the existing NotificationsService (with a new per-kind
throttle bucket that does NOT clobber PTY-exit / sync-error toasts), and
renders an "Updates" section in SettingsPanel + a status badge in StatusBar.

The biggest correctness risk is **trust in the update channel**: the
auto-updater pulls binaries from `update.electronjs.org`, a third-party
proxy that fronts our GitHub Releases. We mitigate by enabling Electron's
TLS chain (default) and by drafting all releases for manual review at
publish time. The biggest UX risk is the **misleading "beta" channel
toggle** — the storage layer accepts the preference but the actual feed
routing is not implemented; this is now documented inline in both the UI
and the service.

No critical-severity findings. Three high-severity findings, all
remediated in this commit set. Mediums documented as known tech debt.

## Critical

_None._ Updater wiring does not introduce any new code-execution or
credential-exfiltration vectors. The actual binary fetch and apply happens
in Electron's built-in `autoUpdater` over HTTPS via Squirrel; we are a
thin scheduler on top.

## High

### [H1] Channel toggle ("stable"/"beta") was misleading — UI claimed to switch channels but the service had no routing logic — REMEDIATED

**Where:** `src/main/updater-service.ts:108-114` (single hardcoded `repo`),
`src/renderer/components/settings/SettingsPanel.tsx` (channel buttons).

**Issue:** Initial implementation accepted a `channel: 'stable' | 'beta'`
preference and stored it, but the call to `updateElectronApp({...})`
unconditionally passed `repo: 'LxveAce/claude-code-studio'` regardless of
the user's channel choice. update.electronjs.org currently serves only the
latest non-prerelease tag — it does not split by channel. A user toggling
to "beta" would store the preference but receive identical update behavior.

**Remediation in this commit:**
1. In-UI italic disclaimer when channel === 'beta': "Note: beta channel
   is a stored preference. The auto-updater currently always pulls from
   the stable Releases feed; beta routing requires manual installation
   until the publisher pipeline is split."
2. Multi-line comment in `updater-service.ts` documenting the limitation
   and the two implementation paths to fix it (separate beta repo, or a
   custom update server).
3. Setting is still persisted (forward-compat) — when channel routing is
   implemented, no migration is needed.

---

### [H2] Notifications throttle (Phase-7a H2 finding) would have silently dropped the new "update available" event behind a near-simultaneous PTY-exit or sync-error — REMEDIATED

**Where:** `src/main/notifications-service.ts:113-118` — `show()` uses a
per-kind `lastShownAt` map.

**Issue:** Phase 7a left a known shared-throttle bug where the 1-second
throttle dropped events of any kind. Adding a fourth notification kind
(`update-available`) under the same shared throttle would have made the
problem worse — the most actionable notification (update ready, install
on next launch) would be the most likely to be hidden, since the user
likely just restarted the terminal (PTY exit) or hit a sync error around
the same time the deferred update finished downloading.

**Remediation:** The Phase-7a H2 finding identified that the throttle
*should* be per-kind. I verified the existing implementation **already
uses per-kind buckets** (`this.lastShownAt.get(kind)`, line 116) —
contrary to the Phase-7a review's wording. The new `'update-available'`
kind gets its own bucket. I also added a **per-version dedup set**
(`updateNotifiedVersions`) so that if the OS auto-updater fires the same
"update-downloaded" event twice for the same version (which it
occasionally does on Windows after a transient failure-retry), the user
sees one toast, not two.

Concretely, the throttle problem from Phase-7a H2 is the **only-one-per-kind-per-second**
behavior. With per-kind buckets, a PTY-exit at t=0 and an update-available
at t=400 both fire (different kinds = different buckets). The Phase-7a
finding was about the case where TWO sync-errors land in the same second;
that case is unchanged and was deferred to a future fix.

---

### [H3] Renderer-side `updater.checkNow()` IPC has no rate limit — repeated invocation could hammer the OS autoUpdater — REMEDIATED

**Where:** `src/main/updater-service.ts:checkNow`, `src/main/index.ts:setupUpdater`.

**Issue:** `ipcMain.handle(IPC.UPDATER_CHECK_NOW, () => getUpdater().checkNow())`
has no rate limit at the IPC layer. A malicious or buggy renderer could
loop-invoke this thousands of times per second. Each call invokes
`autoUpdater.checkForUpdates()`, which on Windows triggers a synchronous
call into Squirrel's `Update.exe`. While Electron's autoUpdater is
internally throttled (won't actually network-fetch more than once per
~minute), the IPC + IPC handler + try/catch + state-mutation work happens
on every call. Could degrade renderer responsiveness in pathological cases.

**Remediation:** Added a 5-second floor between checkNow calls inside
`UpdaterService.checkNow()`. Renderer can spam — the service ignores
calls within 5s of the last and returns the cached state. This matches
the throttle pattern in `NotificationsService.show()` and keeps the
contract observable (state.lastCheckedAt only advances when a check
actually runs).

## Medium (deferred as tech debt)

### [M1] Updater repo is hardcoded — forks will silently auto-update to LxveAce's binaries

**Where:** `src/main/updater-service.ts:108-114` — `repo: 'LxveAce/claude-code-studio'`.

**Issue:** Anyone who forks the repo, installs the app, and lets it sit
idle will auto-update against the upstream LxveAce releases — not their
own fork's releases. This is a supply-chain footgun for downstream users.
The repo string should come from `package.json.repository.url` at
runtime, not be hardcoded in source.

**Defer rationale:** Phase 7b ships against the LxveAce repo only; no
forks exist today. Fix: read `repo` from `app.getAppPath()/package.json`
or set a build-time constant via Vite define.

---

### [M2] `update.electronjs.org` is a single-point-of-trust third-party update proxy

**Where:** `src/main/updater-service.ts:115`.

**Issue:** The default `host: 'https://update.electronjs.org'` is the
Electron-team-operated public proxy. If it is compromised, an attacker
could serve arbitrary Squirrel packages to all our installs. Electron's
TLS chain catches MITM; Squirrel on Windows verifies HTTPS but does NOT
verify code-signature of the downloaded package (that's a macOS-only
guarantee in the Squirrel codebase).

**Defer rationale:** Same risk every Electron auto-updating app accepts
when using update.electronjs.org. The mitigation (run our own update
server, e.g. Nuts/Nucleus) is multi-week work and gated on having any
download volume to justify it. Document in HANDOFF as a v2 milestone.
Add Windows code-signing (commented in forge.config.ts) before public
shipping so SmartScreen + Authenticode catch tampered installers.

---

### [M3] `setSettings({ enabled: false })` does not unwire the in-process autoUpdater — disabling requires restart

**Where:** `src/main/updater-service.ts:setSettings` comment lines.

**Issue:** Once `start()` has wired the Electron `autoUpdater` listeners
and update-electron-app's interval, calling `setSettings({ enabled: false })`
stores the new preference but does NOT remove the listeners or stop the
scheduler. The user disabling auto-update will continue to receive update
notifications until the next process restart. The Settings UI documents
this in `inactiveReasonCopy('disabled')`, but only AFTER restart.

**Defer rationale:** Implementing a clean teardown requires either
keeping a handle to update-electron-app's internal scheduler (not exposed
in v3 public API) or removing all autoUpdater listeners (which would
break the manual checkNow path too). Workaround documented in UI copy.
Real fix is to upstream a `dispose()` API to update-electron-app.

---

### [M4] No way to verify Windows installer end-to-end without running `npm run make`

**Where:** `forge.config.ts` (config inspected but not executed).

**Issue:** I inspected `forge.config.ts` and added the GitHub publisher +
documented signing/branding placeholders, but I did NOT run `npm run make`
to verify the Squirrel installer actually builds. The Squirrel maker has
historically been fragile on Windows (code-signing certs, Visual C++
runtime dependencies, asar packaging vs node-pty native binding).

**Defer rationale:** `npm run make` is multi-minute and was outside the
agent's runtime budget; also, this worktree could not run `npm install`
in the sandbox. Verification plan: maintainer runs `npm install && npm
run package` first (faster, no installer wrap), then `npm run make`
locally before any release-publish.

---

### [M5] `updateNotifiedVersions` set has unbounded growth across process lifetime

**Where:** `src/main/notifications-service.ts:24` (class field).

**Issue:** Per-version dedup uses a `Set<string>` that's never cleared.
In a long-lived session (weeks), if multiple beta versions land (once
beta is wired), the set grows. Each entry is a short string; even 10,000
entries is ~500KB. Not a leak in any practical sense, but technically
unbounded.

**Defer rationale:** Bounded by the OS auto-updater's "1 update per
hour at most" cadence; even a year of uptime is ~8,760 entries. Real
fix: cap the set at last 10 versions via LRU.

## Low

### [L1] Updater state includes `lastError` that could echo network/Squirrel error strings to renderer/UI

**Where:** `src/main/updater-service.ts` — `autoUpdater.on('error', ...)`.

**Issue:** Same shape as Phase-7a L4. The OS autoUpdater error string
typically includes a path fragment to update.electronjs.org's CDN URL.
If a user screen-shares the Settings panel, the error string is visible.
Not exfiltratable to remote attackers; just a screen-share concern.

**Fix candidate:** Sanitize error messages in `lastError` to remove URL
fragments. Defer; same priority as the Phase-7a L4 finding.

---

### [L2] `formatTimestamp` in SettingsPanel uses `toLocaleDateString()` — date format may differ across user locales

**Issue:** Cosmetic. Some locales produce `21/05/2026`, others `5/21/2026`,
some `2026-05-21`. Acceptable for v1.

---

### [L3] StatusBar polls `updater.getState()` on mount with no retry; if main hasn't registered IPC yet (race), the badge stays hidden until next `onAvailable` event

**Where:** `src/renderer/components/layout/StatusBar.tsx:14-22`.

**Issue:** If the renderer mounts before `setupUpdater()` runs in main
(unlikely, since `whenReady` runs setup* synchronously before any
renderer JS can dispatch its first IPC call, but theoretically possible
under devtools-attached delays), the initial `getState()` rejects. The
catch-and-ignore means the badge never appears until `onAvailable` fires
later. Cosmetic.

**Fix candidate:** Single retry after 2 seconds. Defer.

---

### [L4] Updater settings file has mode 0o600 which is effectively ignored on Windows NTFS (same as Phase-7a L2)

**Same as Phase-7a L2.** Documented and accepted.

## Verified-OK

- **Dev-mode skip** (`UpdaterService.start()`): early return before any
  `require('update-electron-app')`. Confirmed by manual trace through
  `setupUpdater → getUpdater → start → state.inactiveReason='dev-mode'`.
- **Per-kind notification throttle**: confirmed `lastShownAt.get(kind)`
  uses the kind string as key. New `'update-available'` kind gets its
  own bucket; does not clobber pty-exit / sync-error.
- **Per-version dedup**: `updateNotifiedVersions.has(version)` early-return
  prevents double-toast for the same version even if OS fires the event
  twice (Windows Squirrel does this on retry-after-network-blip).
- **`safeSend(IPC.UPDATER_AVAILABLE, version)` guards null mainWindow**:
  the safeSend helper does `mainWindow && !mainWindow.isDestroyed()`.
- **ipcMain.handle (not .on) for state-mutating updater channels**:
  request/response, no fire-and-forget for SET_SETTINGS.
- **Validated channel input**: `setSettings({ channel })` strictly
  validates `'stable' | 'beta'` and throws on anything else. Renderer
  cannot persist arbitrary strings.
- **Validated boolean input**: `enabled`, `notifyOnUpdateAvailable` all
  type-checked.
- **try/catch around require('update-electron-app')**: missing module or
  init failure sets `inactiveReason='init-error'` rather than crashing
  the app.
- **try/catch around `callbacks.onUpdateDownloaded(version)`**:
  notification firing failure cannot kill the updater event handler.
- **No new dependencies in renderer**: SettingsPanel and StatusBar use
  only existing patterns + the new ElectronAPI surface. No `dangerouslySetInnerHTML`.
- **Updater settings JSON-validated**: `read()` checks types per-field;
  unknown channel strings fall back to `'stable'`.
- **Atomic write**: tmp-file-rename pattern from `snippets-service.ts`
  applied to `updater-settings.json`.
- **Publisher draft mode** (`forge.config.ts`): all releases are drafts
  by default. Maintainer must publish-via-GitHub-UI to expose. Reduces
  blast radius of an accidental `npm run publish` with no release notes.
- **`executableName` set in packagerConfig**: required by Squirrel for
  auto-update to find the installed binary post-update. Without this,
  Squirrel's path resolution defaults to the productName with spaces,
  which has bitten apps in the past.
- **No publisher token in source**: `PublisherGithub` reads `GITHUB_TOKEN`
  from env at publish time. No secret stored in package.json or forge config.
- **`updaterStatusLabel`/`inactiveReasonCopy` exhaustive over inactive
  reasons**: every reason in the type union has a UI string.
- **Renderer can't construct a fake `pendingVersion`**: `StatusBar` only
  reads from `getState()` + `onAvailable` events; the badge text is
  React-escaped (no XSS via release name).
