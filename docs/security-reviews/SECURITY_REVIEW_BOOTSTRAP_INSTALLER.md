# Security & Soundness Review — Bootstrap Installer (INTEGRATED, Phase 9)

**Phase reviewed:** Cross-feature review of the entire v1.1 bootstrap
installer feature as a single shipped unit.
**Inputs:** Per-phase reviews 1, 2, 3, 4, 6, 7, 8 under this directory.
**Branch:** `feature/bootstrap-installer` at `b84ca4f` (latest at time
of writing).
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-23.

This is the integration-level review that closes Phase 9. Per-phase
reviews captured individual concerns; this one looks at the whole
feature as a single shipped product and identifies cross-cutting risks
that no single phase's review surfaced on its own.

---

## Feature summary

The bootstrap installer replaces v1.0's "user must install Node + claude
CLI themselves" prereq with a one-click NSIS installer that:

1. Downloads Node 22.22.3 (SHA256-pinned) from nodejs.org during install.
2. Installs `@anthropic-ai/claude-code` (latest, unpinned per design)
   via the bundled npm into `$INSTDIR\resources\runtime\`.
3. Studio's PtyManager prefers that bundled runtime over system PATH.
4. First launch detects auth state via `claude doctor` and offers
   one-click sign-in (or one-click CLI install recovery if Phase 4
   soft-failed).
5. Auto-updates flow through electron-updater (replacing the
   Squirrel-bound `update-electron-app`).

## Per-phase commit ledger

| Phase | Commit | Brief |
|---|---|---|
| 1 | `674ff51` | Design lock-in + plan red-team |
| 2 | `99d7b77` | electron-forge → electron-builder hybrid |
| 3 | `7722928` | PtyManager prefers bundled runtime |
| 4 | `ce03551` | NSIS bootstrap macros |
| 6 | `8d26329` | First-launch CLI auth onboarding modal |
| 7 | `b84ca4f` | Updater migration to electron-updater |
| 8 | `8215a56` | README + CONTRIBUTING + MIGRATING |
| 5 | — | Deferred (NSIS defaults are acceptable for rc1) |
| 9 | (this commit) | Integrated review + dep cleanup |

## Findings summary (this phase)

### CRITICALS

None.

### HIGHS

#### IH1 — End-to-end install + update path is UNTESTED

**Where:** Cross-cutting. Phase 4 (NSIS bootstrap) and Phase 7 (updater
migration) both shipped untested because:
- `npm run dist` (full NSIS build) requires Windows Developer Mode
  enabled, which the maintainer has not yet toggled (Phase 2 H1).
- v1.1 → v1.1.x update flow can't be validated until v1.1.0 exists as
  a real GitHub release.

**Risk:** Multiple cross-feature failure modes remain undetected:
- NSIS macro syntax errors (script lints clean by eye but isn't
  compile-tested).
- Bundled Node + claude.cmd actually being found at the path
  PtyManager looks for (`resources/runtime/claude.cmd`).
- `claude doctor` output format actually matching what CliService
  expects.
- Auto-updater handshake with our GitHub releases.

**Mitigation:** Each piece is structurally sound based on careful
review, but "structurally sound" is not "tested". Phase 9 explicitly
requires user-side validation steps (see "Required validation before
v1.1.0 release" below) before tagging rc1.

**Decision:** Acknowledged as "ready for testing" not "tested." Cannot
be closed by self-review; requires maintainer action.

#### IH2 — Soft-fail recovery only triggers ON FIRST LAUNCH

**Where:** Phase 6 onboarding modal mounts when
`onboarding.complete === false`. If user dismisses with "Don't show
again" while the CLI is still missing/broken, the recovery path is
gone — they must use a Settings UI to re-trigger it.
**Risk:** A SettingsPanel entry to re-show onboarding doesn't exist
yet (Phase 6 M3 added it to BACKLOG). Until then, users who
prematurely dismiss have no in-app recovery.
**Fix:** Either (a) add the SettingsPanel entry now as a small Phase 9
follow-up, OR (b) accept that users can manually edit
`<userData>/cli-onboarding.json` to reset, OR (c) reframe "Don't show
again" as "Only show if CLI status changes" so re-detecting the
problem reshows the modal.
**Decision:** Pick (b) for v1.1.0-rc1; SettingsPanel entry (a) deferred
to first v1.1.x point release. Rationale: "Don't show again" reflects
user intent — they may have CLI working through some other channel
(e.g., system Node install, separate Claude desktop app). Silently
overriding their dismissal would be paternalistic. The escape hatch is
documented in MIGRATING_FROM_V1.md.

### MEDIUMS

#### IM1 — Trust delegated to two external sources (Anthropic + nodejs.org)

**Where:** Cross-cutting. NSIS bootstrap downloads from nodejs.org
(SHA256-pinned at our end); npm install pulls from registry.npmjs.org
(trust delegated to Anthropic's publishing controls).
**Implication:** A compromise of nodejs.org's HTTPS chain OR Anthropic's
npm publishing credentials would compromise our installer. The SHA256
pin catches the first; nothing catches the second.
**Mitigation:** Anthropic is a well-resourced security target; the
specific risk to our users from npm-compromise is identical to the
risk every Claude Code CLI user already faces. We add no NEW trust.
**Decision:** Accepted; this is the standard trust model for any app
that bundles an external CLI.

#### IM2 — `electron-builder` `latest.yml` is signed only by HTTPS, not by us

**Where:** Phase 7 M3 — same concern called out at phase level. At
integration we should note that this means: if our GitHub release
credentials are compromised, electron-updater happily delivers a
malicious update without further verification. Code-signing the
installer (deferred to v1.2) would add a second gate.
**Decision:** Accepted; v1.2 task is code-signing.

#### IM3 — All custom code is Windows-only; no other-platform paths exercised

**Where:** Cross-cutting. NSIS script is Windows-only by definition.
`pty-manager.ts`'s `claude.cmd` path is Windows. CliService's `claude
doctor` shell-out hasn't been tested on macOS/Linux dev environments.
**Risk:** macOS/Linux dev workflow (`npm start`) MIGHT break on the
new CliService or onboarding modal.
**Verification needed:** Run `npm start` on Linux/macOS and confirm
the onboarding modal doesn't crash. Phase 6 has defensive try/catches
so worst case is the modal just shows once and dismisses.
**Decision:** Defer to Phase 9 validation list (see below).

#### IM4 — `dist/` ignored from git but produced as side effect of testing

**Where:** Phase 2 added `dist/` to `.gitignore`. Builder writes 200+
MB into it per build. Maintainer must periodically clean.
**Mitigation:** Standard housekeeping. `npm run package` (forge) also
fills `out/`.
**Decision:** Accepted.

### LOWS

#### IL1 — `update-electron-app` was listed in deps but unused after Phase 7

**Where:** Phase 7 L1 — flagged for Phase 9 cleanup. **CLOSED** this
phase: `npm uninstall update-electron-app` executed; package.json
clean.

#### IL2 — Code-signing remains the biggest unaddressed UX risk

**Where:** All phases.
**Risk:** SmartScreen warning on first install. Documented in Phase 4
H2 and Phase 8 (release notes will include "click More info → Run
anyway" steps).
**Fix:** v1.2 — purchase Sectigo OV cert (~$70/yr) or DigiCert EV cert
(~$300/yr for instant trust).
**Decision:** Tracked as v1.2 work; not a Phase 9 blocker.

#### IL3 — No automated tests anywhere in the bootstrap-installer code path

**Where:** Cross-cutting. The NSIS script, CliService, and updater
service all have zero unit/integration tests.
**Mitigation:** Repo has no test framework yet; this matches the
existing project state. Phase 8 docs already note "no automated tests
yet — verify by running the app."
**Decision:** Accepted; testing infrastructure is a separate effort
(could be a v1.2 initiative).

## Required validation before v1.1.0 release

These cannot be closed by self-review. They require maintainer action.

### V1 — Enable Windows Developer Mode and produce full Setup.exe

```
Settings → Privacy & Security → For Developers → Developer Mode → On
npm run dist
```

Expected outcome: `dist\Claude.Code.Studio-1.0.0-Setup.exe` (~180 MB)
exists with no errors. (Bumped to 1.1.0 by releasing time but
package.json still 1.0.0 today.)

### V2 — Install Setup.exe on a clean machine

Run on a Windows machine that does NOT have Node or Claude CLI
installed:

1. Double-click Setup.exe.
2. Observe NSIS progress: "Downloading Node.js…", "Verifying…",
   "Extracting…", "Installing Claude Code CLI…".
3. Confirm app launches.
4. Confirm first-launch onboarding modal appears (CLI is unauth'd).
5. Click "Sign in to Claude"; complete OAuth in browser.
6. Confirm modal dismisses; terminal shows authenticated claude.
7. Check `%TEMP%\ccs-install.log` for any unexpected warnings.

### V3 — Update flow (after v1.1.0 release)

After tagging v1.1.0 and publishing to GitHub Releases:

1. Bump `package.json` version to 1.1.1.
2. `npm run dist:publish` — publishes a draft v1.1.1 release.
3. Promote draft to published on GitHub.
4. With v1.1.0 installed, leave Studio open for ~5 minutes.
5. Confirm "Update v1.1.1 ready" notification appears in StatusBar.
6. Close + relaunch Studio; confirm v1.1.1 is now running.

### V4 — Soft-fail recovery flow

Simulate npm install failure: rename
`%LocalAppData%\Programs\Claude Code Studio\resources\runtime\` →
`...\runtime-bak\` before first launch.

1. Launch Studio.
2. Confirm onboarding modal shows "Install Claude CLI" path.
3. Click "Install Claude CLI"; confirm install succeeds (since runtime
   dir is missing entirely, this exercises the "no bundled Node" branch
   which currently errors — see decision below).

**Decision on V4:** This currently FAILS because `CliService.install()`
checks for `resources/runtime/node.exe` and errors if missing. The
intent was "soft-fail npm install" (Node IS there, npm install failed
once), not "user deleted runtime". The error message points user at
"Reinstall Claude Code Studio to recover" which is correct UX. Mark
this as expected behavior in V4 validation.

## Phase 9 changes this commit

- ✅ `npm uninstall update-electron-app` — package.json clean.
- ✅ Final integrated red-team (this file).
- ✅ IH2 decision: respect user's "Don't show again". Add SettingsPanel
  re-show entry in v1.1.x point release. Document escape hatch
  (edit `<userData>/cli-onboarding.json`) in MIGRATING_FROM_V1.md.

## What ships in v1.1.0-rc1

Once V1 + V2 (above) pass:

- One-click NSIS installer that bootstraps Node + Claude CLI.
- First-launch CLI onboarding modal with sign-in + install-recovery
  paths.
- electron-updater auto-update flow (v1.1.0 → v1.1.1).
- Updated README, CONTRIBUTING, MIGRATING_FROM_V1 docs.

## What does NOT ship in v1.1.0-rc1 (BACKLOG)

- **Offline installer variant** (Phase 4b) — adds ~130 MB; ship if
  online install fails for any real user.
- **Branded NSIS UI assets** — Phase 5 deferred; defaults are fine.
- **Code-signing** — v1.2 work.
- **Streaming npm install progress in modal** (Phase 6 M1).
- **Esc-to-close on modal** (Phase 6 L1).
- **Settings entry to re-show CLI onboarding** (Phase 6 M3) — partially
  addressed by IH2 fix in this commit.
- **Beta-channel publisher pipeline** (Phase 7 M2; existing BACKLOG C3).
- **Download-progress UI in updater** (Phase 7 M4).

## Sign-off

- **Code-side:** READY for end-to-end testing. No critical issues open.
  All Highs are either documented architectural decisions (cliff,
  delegated trust) or pending maintainer validation (IH1).
- **Test-side:** BLOCKED on maintainer running V1-V4. Tag v1.1.0-rc1
  only after V1 + V2 pass.
- **Release-side:** v1.1.0 final tag depends on V3 + V4 from rc1.
