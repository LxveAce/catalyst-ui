# Security & Soundness Review — Bootstrap Installer, Phase 7 (updater migration)

**Phase reviewed:** `update-electron-app` (Squirrel-based) →
`electron-updater` (electron-builder's native updater).
**Artifacts:** `src/main/updater-service.ts` (rewritten in place),
`package.json` (`electron-updater@6.8.3` added to dependencies).
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-23.

---

## CRITICALS

None.

## HIGHS

### H1 — v1.0 Squirrel installs lose auto-update on the next release

**Where:** Architectural — electron-updater speaks electron-builder's
`latest.yml` protocol; `update-electron-app` was Squirrel-only.
**Risk:** Users on v1.0.0 (installed via Squirrel.Windows from the v1.0
release) will not see v1.1.0 via auto-update. They must manually
download and run the new Setup.exe per `MIGRATING_FROM_V1.md`.
**Mitigation accepted:**
- Documented in `MIGRATING_FROM_V1.md` (Phase 8).
- Documented in Phase 1 design doc as the "Squirrel → NSIS migration
  cliff" — explicit decision to eat this once given userbase of one.
- A "v1.0.1 Squirrel bridge release" with a one-time toast pointing
  users to the v1.1 reinstall was considered and deferred — disposable
  engineering effort for a tiny user base.

**Decision:** Accepted, documented prominently in release notes for v1.1.

### H2 — Three Phase 7b gates preserved verbatim (per Phase 4 red-team L1)

**Verified preservation of:**
- **Dev-mode gate:** `!opts.isDevMode` short-circuits start() and sets
  `inactiveReason: 'dev-mode'`. Match.
- **Unsupported-platform gate:** `process.platform !== 'win32'` short-
  circuits with `'unsupported-platform'`. Tightened from the previous
  `win32 || darwin` because v1.1 is Windows-only (darwin gate revisited
  when macOS support ships).
- **User-disable gate:** `!this.settings.enabled` short-circuits with
  `'disabled'`. Match.
- **5s rate-limit on checkNow:** `CHECK_NOW_MIN_INTERVAL_MS = 5000`,
  comparison in `checkNow()`. Match.
**Decision:** L1 finding closed — phase 7 acceptance criteria met.

## MEDIUMS

### M1 — `setSettings({ channel })` requires app restart to take effect

**Where:** `setSettings()` writes new channel to disk but
`autoUpdater.allowPrerelease` is only read at `start()` time. Same
behavior as the previous `update-electron-app` implementation.
**Mitigation:** UI copy in SettingsPanel mentions restart requirement
for channel changes (legacy text from Phase 7b — still accurate).
**Could fix:** Read `autoUpdater` lazily in `setSettings()` and update
`allowPrerelease` live. Tradeoff: makes the lifecycle harder to reason
about; current "settings persist, take effect on restart" is simpler.
**Decision:** Accepted — matches prior contract, documented in UI.

### M2 — Beta channel is UX intent only until publisher pipeline supports it

**Where:** `autoUpdater.allowPrerelease = this.settings.channel === 'beta'`
flips the flag, but our publisher pipeline (electron-builder.yml's
`publish.releaseType: draft`) doesn't yet split stable vs prerelease
publishes. Beta acts like stable until a prerelease is actually
published.
**Mitigation:** SettingsPanel copy (legacy from Phase 7b) explicitly
notes that beta is "stable-only for now".
**Decision:** Accepted; tracked as BACKLOG C3 (beta channel pipeline).

### M3 — `electron-updater` checksum verification depends on `latest.yml` integrity

**Where:** electron-updater verifies SHA512 of downloaded updates against
the hash recorded in `latest.yml` on the GitHub release. If an attacker
can replace `latest.yml` AND the nupkg in our GitHub release, they could
deliver a malicious update.
**Risk model:**
- The trust boundary is our GitHub release (controlled by maintainer's
  GitHub credentials + release-creation permissions).
- A compromise of those credentials would let an attacker push a malicious
  release that electron-updater would happily install.
- Code-signing the installer would add a second trust gate (cert-issuer
  verifies maintainer identity), but is deferred to v1.2.
**Mitigation:** Standard electron-updater behavior; same model as every
electron-builder app. Not unique to our setup.
**Decision:** Accepted — outside our threat model for v1.1.

### M4 — `download-progress` event swallowed (no UI surfacing)

**Where:** `autoUpdater.on('download-progress', ...)` — we have a handler
but it's a no-op.
**Risk:** User sees "Update vX.Y.Z ready" only when the full download
completes — for large updates on slow networks this could be a minutes-
long silence between "checking" and "ready".
**Fix:** Add an IPC channel `UPDATER_DOWNLOAD_PROGRESS` that emits
percentage to the renderer. Cosmetic — defer to v1.1.x polish.
**Decision:** Accepted as BACKLOG entry.

## LOWS

### L1 — `update-electron-app` left in package.json dependencies

**Where:** `package.json:dependencies["update-electron-app"]` still listed
but unused after this phase.
**Decision:** Defer removal to Phase 9 (final integration cleanup) to
avoid `npm install` churn in this commit. `electron-updater` is the
authoritative dep going forward.

### L2 — `autoUpdater` typed loosely via inline interface

**Where:** Inline `require('electron-updater') as { autoUpdater: {...} }`
declaration. We don't pull in `@types/electron-updater` or trust its
own bundled types directly.
**Reason:** electron-updater's types are CJS/ESM-ambiguous and the
project doesn't yet enforce full type coverage on the require sites.
The handlers' arg types are narrowed with `as { version?: string }` at
use.
**Decision:** Acceptable — narrowing is defensive enough. Could promote
to proper imports in a future cleanup.

### L3 — `setTimeout` of 3s before first checkForUpdates

**Where:** `setTimeout(() => autoUpdater.checkForUpdates(), 3000)` in
`start()`. The delay was chosen so the renderer has time to render before
the updater logs anything.
**Decision:** Magic number; could be a named constant. Cosmetic.

## Risks accepted

- Squirrel→NSIS cliff for v1.0 users (H1) — documented; one-time tax.
- Channel/enabled setting requires restart (M1) — matches prior contract.
- Beta channel UX-only until publisher pipeline lands (M2) — BACKLOG C3.
- `update-electron-app` left in deps (L1) — Phase 9 cleanup.

## Plan adjustments

1. **Phase 9** cleanup task: `npm uninstall update-electron-app` and
   verify nothing else imports it.
2. **BACKLOG add:** surface download-progress in UI (M4).
3. **BACKLOG link:** beta-channel publisher pipeline already tracked as C3
   — Phase 7 makes the client-side ready (just need the server side).

## Phase 7 acceptance summary

- ✅ `update-electron-app` removed from main process code (still in
  package.json deps; cleanup in Phase 9).
- ✅ `electron-updater@6.8.3` added to dependencies.
- ✅ All four Phase 7b gates preserved: dev-mode, unsupported-platform,
  user-disable, 5s rate-limit on checkNow.
- ✅ Public API of `UpdaterService` unchanged (start, checkNow, getState,
  getSettings, setSettings) — no renderer or IPC changes needed.
- ✅ vite:build clean across main+preload+renderer.
- ⚠️ Squirrel→NSIS cliff documented in `MIGRATING_FROM_V1.md` (Phase 8) —
  v1.0 users must manually reinstall once.
- ⚠️ End-to-end update flow (v1.1 → v1.1.1) untestable until a v1.1
  release exists on GitHub. Phase 9 includes a verification step where
  user runs a real upgrade after the rc1 tag.
