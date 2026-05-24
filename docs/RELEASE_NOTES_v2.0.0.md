# Claude Code Studio v2.0.0 — Release Notes (Draft)

> Template — fill in the verification checkmarks and bump
> `package.json` to `2.0.0` (drop the `-dev.1` suffix) before publishing.

**Headline:** v2.0 ships on **Windows, macOS, and Linux** with a one-click
bootstrap installer that sets up Node + the Claude CLI for you. No more
manual `npm install -g` step on any platform.

---

## What's new in v2.0

### Cross-platform support

| OS | Installer | Bootstrap timing |
|---|---|---|
| **Windows** | NSIS Setup.exe (one-click silent install) | At install time via the installer |
| **macOS Intel** | DMG drag-to-Applications (x64) | At first launch via the onboarding modal |
| **macOS Apple Silicon** | DMG drag-to-Applications (arm64) | At first launch |
| **Linux Debian / Ubuntu** | `.deb` package via `dpkg -i` | At first launch |
| **Linux Fedora / RHEL** | `.rpm` package via `rpm -i` or `dnf` | At first launch |
| **Linux any distro** | AppImage (portable single file) | At first launch |

Same Node 22.22.3 runtime and same `@anthropic-ai/claude-code` CLI on
every platform. Same SHA256-pinned downloads, same registry pinning,
same security posture.

### First-launch onboarding (all platforms)

The onboarding modal — which already shipped in v1.1 on Windows — now
works on macOS and Linux too. It:

1. Detects if `claude` is installed and authenticated via `claude doctor`.
2. If missing: "Install Claude CLI" button downloads Node + Claude CLI
   into `<userData>/runtime/` with live streaming progress.
3. If unauthenticated: "Sign in to Claude" types `claude login` into
   the embedded terminal so the CLI can open your browser for OAuth.
4. "Don't show again" persists the choice. Settings → Claude CLI →
   "Re-show CLI onboarding" undoes it.

### Auto-updates everywhere via electron-updater

Replaced v1.0's Squirrel-only `update-electron-app` with
`electron-updater`. Update flow now works on Windows (NSIS), macOS
(DMG + zip), and Linux AppImage uniformly. deb/rpm rely on the distro
package manager (`apt upgrade` / `dnf upgrade`).

### Other carryovers from v1.1 (not yet released as v1.x)

- Esc-to-close on the onboarding modal.
- Live npm install log streaming in the modal (no more "Installing… (?)"
  silence).
- Download progress indicator in the StatusBar while updates download.
- Re-show CLI onboarding from Settings → Claude CLI.

---

## Upgrading from v1.0

**Windows v1.0 users** must uninstall the Squirrel install before
installing v2.0 — see
[`docs/MIGRATING_FROM_V1.md`](./MIGRATING_FROM_V1.md). Your settings
in `%AppData%\Claude Code Studio\` are preserved automatically.

**macOS and Linux users** are new to Studio in v2.0 — no migration
needed.

---

## Per-platform "first install" warnings

### Windows SmartScreen

The installer isn't yet code-signed (tracked for v2.1). On first run
Windows shows *"Windows protected your PC"*. Click **More info** →
**Run anyway**. Appears once per machine.

### macOS Gatekeeper

The app isn't yet notarized (tracked for v2.1). On first launch
macOS may say *"Claude Code Studio cannot be opened because the
developer cannot be verified."* Right-click the app → **Open** →
confirm in the dialog. Required once.

### Linux

No equivalent warning. `chmod +x` the AppImage if downloaded; deb/rpm
install via your normal package manager.

---

## Known issues

- **Code-signing deferred to v2.1.** Apple Developer Program ($99/yr) +
  Sectigo OV Windows cert (~$70/yr) — both tracked.
- **Linux update channels:** AppImage gets electron-updater. deb/rpm
  rely on your distro's package manager; no in-app update prompt.
  Future v2.x may add a custom repo at packagecloud.io or similar.
- **macOS bootstrap requires `tar` on PATH.** Always present on macOS.
- **Linux bootstrap requires `tar` with xz support.** `xz-utils` is
  standard on Ubuntu 20.04+, Fedora 30+, etc. On minimal images,
  install via `apt install xz-utils` or `dnf install xz`.
- **Bootstrap requires internet during first launch.** The CLI is
  ~30 MB + Node is ~30 MB. Online-only; no offline variant yet (BACKLOG
  Phase 4b — ship if any user reports install failure).
- **Beta channel** is settings-only until the publisher pipeline splits
  prerelease routes (BACKLOG C3).

---

## For developers

The hybrid build pipeline carries forge for dev / Squirrel-format builds
and electron-builder for the v2.0 multi-OS installers. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md):

- `npm start` — forge dev (unchanged)
- `npm run dist` / `dist:mac` / `dist:linux` — electron-builder
- `npm run dist:all` — Windows + Linux on a Linux build host (mac needs
  a Mac)

GitHub Actions CI (`.github/workflows/ci.yml`) builds all 3 OSes on
every push via the matrix job. Artifact downloads available for 30
days per run.

Windows local builds need Developer Mode enabled
(see CONTRIBUTING.md).

---

## Maintainer verification checklist

Before publishing v2.0.0:

### Windows
- [ ] CI's `build-installer (windows-latest)` job green, OR
  `npm run dist` succeeds locally with Developer Mode on.
- [ ] Downloaded Setup.exe; ran on a clean Windows machine (or after
  uninstalling v1.0). Bootstrap completes, app launches, onboarding +
  sign-in work.

### macOS
- [ ] CI's `build-installer (macos-latest)` job green for both x64 and
  arm64 DMGs.
- [ ] Downloaded DMG; dragged to Applications; ran with right-click →
  Open (Gatekeeper bypass). First-launch onboarding downloads Node +
  CLI; sign-in works.

### Linux
- [ ] CI's `build-installer (ubuntu-latest)` job green. AppImage + .deb
  + .rpm all produced.
- [ ] AppImage: `chmod +x` + run from terminal. First-launch onboarding
  works.
- [ ] .deb: `sudo dpkg -i` succeeds on Ubuntu 22.04 LTS. App appears in
  applications menu, first launch works.
- [ ] .rpm: `sudo rpm -i` succeeds on Fedora 39+. Same first-launch
  validation.

### Update path
- [ ] After v2.0.0 tag, bumped to v2.0.1 and published. v2.0.0 install
  receives the update via electron-updater (Windows + macOS + Linux
  AppImage). deb/rpm tested with manual package upgrade.

## Publishing v2.0.0

The repo ships a tag-driven release workflow at
`.github/workflows/release.yml`. To publish:

1. Bump `package.json` version → `2.0.0`.
2. Commit, then:
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```
3. The release workflow auto-triggers and runs in parallel on
   windows-latest + macos-latest + ubuntu-latest. Each runs the
   appropriate `npm run dist:publish:*` script with the
   auto-provided `GITHUB_TOKEN`, which lets electron-builder create
   (or update) a draft release tagged `v2.0.0` with all per-OS
   artifacts:
   - `Claude.Code.Studio-2.0.0-Setup.exe` + `latest.yml`
   - `Claude.Code.Studio-2.0.0-x64.dmg`, `...-arm64.dmg`, +
     `latest-mac.yml`
   - `Claude.Code.Studio-2.0.0-x64.AppImage` +
     `claude-code-studio_2.0.0_amd64.deb` +
     `claude-code-studio-2.0.0.x86_64.rpm` + `latest-linux.yml`
4. Once V1-V4 above pass on the draft release, edit the GitHub
   release → uncheck **Set as a pre-release** if checked → **Publish
   release**. electron-updater's `latest*.yml` feed picks it up
   immediately for existing installs.

## Verifying auto-update post-publish

After the v2.0.0 release is published (not just drafted), confirm
auto-update by:

1. Install v2.0.0 from the published release.
2. Bump `package.json` to `2.0.1`, commit:
   ```bash
   git tag v2.0.1 && git push origin v2.0.1
   ```
   The release workflow publishes v2.0.1 as a draft.
3. **Promote v2.0.1 from draft → published on GitHub.** This is the
   critical step — drafts are invisible to `electron-updater`. The
   feed at `https://github.com/LxveAce/claude-code-studio/releases/latest/download/latest.yml`
   (or `latest-mac.yml` / `latest-linux.yml`) needs to point at the
   newer release.
4. Open the running v2.0.0 install. Within ~5 minutes (the
   `update-electron-app` default check interval — applies the same
   for electron-updater), the StatusBar shows
   *"Downloading update… X%"* then *"Update v2.0.1 ready"*.
5. Close and reopen the app. v2.0.1 is now running.

If step 4 doesn't fire, hit Settings → Updates → **Check now**
(rate-limited to once per 5s) to force a poll.

**Per-platform caveats:**
- **Linux deb / rpm installs** don't auto-update — that's a property
  of those formats, not a bug. Users update via
  `sudo apt upgrade claude-code-studio` (deb) or
  `sudo dnf update claude-code-studio` (rpm) after the publisher
  pipeline ships to those repos (not v2.0 — future work).
- **Linux AppImage** does auto-update via electron-updater. The
  current AppImage gets replaced in-place when the user accepts the
  restart prompt.
- **macOS** updates via the `.zip` artifact (electron-updater
  applies the zip onto the running app bundle). DMG is just the
  install-time delivery format.
- **Windows** updates via Squirrel-Windows-style delta or full from
  the NSIS Setup.exe.

---

## Credits

- Phase 4-9 (Windows bootstrap installer) shipped on
  `feature/bootstrap-installer` — 15 commits, 10 per-phase red-team
  reviews under `docs/security-reviews/`.
- v2.0 multi-OS work shipped on `feature/macos-support` (acted as the
  multi-OS branch since macOS + Linux share the same cross-platform
  code path).
- Friend's prior PRs (anjaustin/*) all merged into master before this
  effort started.
- LMM thinking discipline + per-phase red-team applied throughout.
  Per-source-file analyses under `journal/`.
