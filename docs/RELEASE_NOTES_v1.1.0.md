# Claude Code Studio v1.1.0 — Release Notes (Draft)

> Template — fill in the verification checkmarks and bump to v1.1.0 (drop
> the `-dev.1` suffix in package.json) before publishing.

**Headline:** v1.1 ships a one-click installer that bootstraps Node and
the Claude Code CLI for you. No more separate npm install — double-click
and go.

---

## What's new

### One-click installer (`Claude.Code.Studio-1.1.0-Setup.exe`)

The installer now sets up everything Claude Code Studio needs in a single
flow:

1. Downloads Node.js 22.22.3 from nodejs.org (~30 MB, SHA256-verified).
2. Installs `@anthropic-ai/claude-code` into the app's own runtime
   directory (no system-wide Node install).
3. Launches the app on completion.

No prerequisites. No `npm install -g`. No PATH setup.

### First-launch CLI sign-in

If you haven't signed in to Claude yet, a one-time onboarding modal
walks you through:

- "Install Claude CLI" (only shown if the installer's npm step soft-
  failed — usually skipped)
- "Sign in to Claude" — types `claude login` into the terminal for you,
  CLI handles the rest via your browser

Once signed in, the modal won't show again.

### Auto-updates via electron-updater

v1.1.x updates apply silently in the background and prompt you to
restart when ready. No more Squirrel-style invisible updates — you'll
see a "Update vX.Y.Z ready" badge in the status bar before any
restart.

---

## Upgrading from v1.0

**Important:** v1.0 installs cannot auto-update to v1.1. You must
manually uninstall once. See [`docs/MIGRATING_FROM_V1.md`](./docs/MIGRATING_FROM_V1.md)
for the step-by-step.

Your data (settings, snippets, vault sync state, GitHub PAT, theme
preference) lives in `%AppData%\Claude Code Studio\` and is preserved
across the upgrade automatically.

---

## "Windows protected your PC" warning

The installer isn't yet code-signed (tracked for v1.2 — Sectigo OV or
DigiCert EV cert). On first run you'll see Windows SmartScreen warn
about it:

1. Click **"More info"** in the warning dialog.
2. Click **"Run anyway"** at the bottom of the expanded dialog.

This only appears once per machine. After install, the app launches
normally.

---

## Known issues

- **Bootstrap requires internet during install.** The installer
  downloads Node + the CLI from the network. If you're behind a corporate
  proxy or on flaky WiFi, the install may fail. An offline-installer
  variant is tracked for a v1.1.x point release (BACKLOG Phase 4b).
- **First install can take 30-90 seconds.** Most of that is downloading
  Node + installing the CLI. Subsequent installs (over an existing
  v1.1.x) are faster because the runtime is already in place.
- **Beta channel is UX-only.** SettingsPanel has a stable/beta channel
  toggle but the publishing pipeline doesn't yet split prerelease
  routes — beta currently acts like stable. Tracked as BACKLOG C3.

---

## For developers

- Project now ships with a hybrid build pipeline: `electron-forge` for
  dev (`npm start` unchanged), `electron-builder` for the NSIS
  installer. See `CONTRIBUTING.md` for the build-pipelines table.
- Local installer builds require **Windows Developer Mode enabled** —
  one-time toggle in *Settings → Privacy & Security → For Developers*.
  See `docs/INSTALLER_REDESIGN.md` for the why.
- GitHub Actions CI builds Setup.exe on every push to `master` and
  `feature/*` branches (no Dev Mode needed — runners have admin).
  Setup.exe lands as a `claude-code-studio-windows-installer` artifact
  on the CI run.

---

## Maintainer verification checklist

Before publishing, confirm all four boxes are checked:

- [ ] **V1** — `npm run dist` succeeds locally on Windows (with
      Developer Mode enabled), or CI's "Build NSIS Setup.exe" job is
      green for the merge commit.
- [ ] **V2** — Downloaded the resulting Setup.exe, ran it on a clean
      Windows machine (or one with v1.0 uninstalled). Bootstrap
      completes, app launches, onboarding modal appears, sign-in works,
      terminal shows authenticated claude.
- [ ] **V3** — After publishing v1.1.0, bumped package.json to v1.1.1,
      ran `npm run dist:publish` to draft a v1.1.1 release. Promoted it
      to published. On a running v1.1.0, confirmed `Update v1.1.1 ready`
      appears within ~5 minutes, and restart applies it.
- [ ] **V4** — Simulated Phase 4 soft-fail by renaming
      `<install>/resources/runtime/` mid-test. Confirmed the
      onboarding modal shows the correct recovery message.

Then bump `package.json` from `1.1.0-dev.1` to `1.1.0`, tag, and run
`npm run dist:publish`.

---

## Credits

- Phase 4-9 design + implementation: shipped on
  `feature/bootstrap-installer` branch, 10 commits, full per-phase
  red-team reviews under `docs/security-reviews/`.
- Per-source-file LMM analyses under `journal/` updated to reflect the
  v1.1 architecture.
- Friend's prior PRs (anjaustin/* — repo structure, journal organization,
  resize-loop fix, NaN bug doc) all merged into master before this
  branch was cut.
