# Security & Soundness Review — v2.0 Multi-OS Support (Integrated)

**Phase reviewed:** macOS + Linux support added on top of v1.1 Windows
bootstrap. Code centralized via `src/main/runtime-paths.ts`; CliService
gains in-app Node bootstrap for non-Windows; electron-builder.yml +
package.json + CI matrix wired for all 3 OSes.
**Branch:** `feature/macos-support` at `6747b0b` (functioned as the
multi-OS branch).
**Reviewer:** assistant (self-red-team).
**Date:** 2026-05-24.

---

## CRITICALS

None. The new code reuses the Phase 4 / Phase 6 security model:
SHA256-pinned downloads, registry-pinned npm, soft-fail recovery,
defensive error handling. Cross-platform path resolution is one
centralized module with explicit `process.platform` branches.

## HIGHS

### IH1 — Bootstrap downloads + executes a Node binary at first launch on macOS/Linux

**Where:** `CliService.bootstrapNodeRuntime()`. Downloads ~30 MB Node
tarball from nodejs.org, verifies SHA256 against a hard-coded hash,
extracts via OS `tar`, then runs the bundled `node` as a child process
to install Claude CLI.
**Risk model:** This is the same model as the Windows NSIS bootstrap
just relocated from install-time to first-launch — same trust boundary
(nodejs.org's HTTPS + Anthropic's npm publishing) and same SHA gate. The
incremental risk vs the Windows path is:
- **Lower:** runs in the user's session at runtime, not in an installer
  with elevated privileges. Worst case is a compromised CLI in the user's
  own `~/Library/.../Studio/runtime/`, not a system-level compromise.
- **Higher:** runs after the user has been using the app for some time
  (presumably long enough to dismiss the "Maybe later" button), so the
  attack surface is "longer-lived". Compromised Node download could
  persist across launches until the user notices.
**Mitigation:** SHA256 verification is the same on all three platforms.
A compromised nodejs.org HTTPS chain would compromise every Node app on
every OS, not just us.
**Decision:** Accepted — same trust model as v1.1.

### IH2 — Cross-platform code untested on macOS + Linux

**Where:** Everything in `runtime-paths.ts` non-Windows branches,
`CliService.bootstrapNodeRuntime()`, `CliService.extractTo()`.
**Risk:** This code compiles and type-checks but has not been run on a
real macOS or Linux machine yet. Possible breakages:
- `tar -xJf` (xz) requires `xz-utils` on minimal Linux distros.
- macOS `tar` is BSD tar; the flag set we use (`-xzf`) is compatible
  but newer flags wouldn't be.
- `fs.renameSync` across mount points (e.g. tmpfs `$TMPDIR` → home
  partition) fails with `EXDEV`. We extract IN the destination so this
  shouldn't trigger, but worth verifying.
- npm install on macOS may require `python3` for native deps; our pinned
  package shouldn't need that, but worth confirming.
**Mitigation:** CI matrix build (`build-installer` job for
windows-latest + macos-latest + ubuntu-latest) will surface compile/run
breakage at the package level. Functional testing requires user-side
validation on each OS (see RELEASE_NOTES_v2.0.0.md checklist).
**Decision:** Accepted as known-unknown; tagged for V1+V2 validation
before publishing v2.0.0.

### IH3 — No code-signing on any platform

**Where:** Windows SmartScreen, macOS Gatekeeper, Linux package signing.
**Risk:** First-launch warnings on all platforms.
- Windows: documented in Phase 1 H2 + Phase 4 H2; "More info → Run anyway".
- macOS: even worse — Gatekeeper hard-blocks unless user right-clicks →
  Open. Notarization is required for first-launch ease.
- Linux: dpkg/rpm complain about unsigned packages depending on system
  config. AppImage doesn't care.
**Decision:** All three deferred to v2.1. Documented in
`RELEASE_NOTES_v2.0.0.md` per-platform warnings section. v2.1 work:
- Apple Developer Program ($99/yr) + osxSign / osxNotarize config.
- Sectigo OV cert ($70/yr) for Windows.
- GPG signing for deb/rpm (optional — many distros accept unsigned for
  user-installed packages).

## MEDIUMS

### IM1 — `runtime-paths.findBundledRuntime()` allows Windows soft-fail recovery to land in `<userData>/runtime/`

**Where:** Windows candidate roots includes both `resources/runtime/`
AND `<userData>/runtime/`. If the Phase 4 NSIS bootstrap soft-fails,
the user can re-run install from the onboarding modal which writes to
`<userData>/runtime/` (since `targetRuntimeRoot` prefers that on
non-Windows... wait, actually it prefers `resources/runtime/` on
Windows).
**Bug found during review:** On Windows packaged builds,
`targetRuntimeRoot()` returns `resources/runtime/`, but the NSIS
install location may not be writable from a non-admin process if the
user changed the install path to `Program Files`. With our default
oneClick + perMachine:false this lands under `%LocalAppData%\Programs\`
which IS writable, but if a future change allows custom install dirs,
the recovery path could fail.
**Mitigation:** Not changing today. Current install path is hardcoded
writable. Comment in runtime-paths.ts notes this.
**Decision:** Accepted; revisit if `allowToChangeInstallationDirectory`
becomes true.

### IM2 — `https.get` follows redirects manually (max 5)

**Where:** `downloadFileWithProgress()` follows 3xx via recursive
`doGet()`. Bounded at 5 redirects.
**Risk:** GitHub releases redirect → Fastly. Currently 1 hop. If
Fastly itself starts redirecting, we still have headroom. An infinite
redirect loop would burn 5 attempts then fail with a clear error.
**Mitigation:** Sufficient.
**Decision:** Accepted.

### IM3 — SHA256 hashes hardcoded for one Node version (22.22.3)

**Where:** `nodeDownloadFor()` returns pinned URLs + hashes.
**Risk:** Bumping Node version is a multi-file change (this map +
NSIS script's NODE_VERSION + SHASUMS lookup). Risk of forgetting one
location.
**Mitigation:** Both locations have comments pointing at the other
("captured 2026-05-24 from SHASUMS256.txt — re-verify on each bump").
A future cleanup could extract NODE_VERSION + per-platform SHA256
into a shared `node-pin.json` or .ts module imported by both NSIS
(via preprocessor) and CliService. Not v2.0 work.
**Decision:** Accepted as tech debt; documented in BACKLOG.

### IM4 — In-app bootstrap doesn't support unsupported (platform, arch) combos

**Where:** `nodeDownloadFor()` returns `null` for platforms we don't
have pinned hashes for (e.g. linux-arm64, freebsd, ...).
**Risk:** User on an unsupported platform gets a clear error message
but no recovery path.
**Mitigation:** Error message tells them to install Node + claude
manually. The app's terminal still works if they have `claude` on PATH.
**Decision:** Accepted. Add linux-arm64 in v2.1 if there's demand (Raspberry
Pi 4 users etc.).

### IM5 — CI matrix has no concurrency cancellation across OSes

**Where:** `.github/workflows/ci.yml` `concurrency` block cancels per
branch. Matrix jobs within a single run are NOT concurrency-managed —
they all run.
**Risk:** Spamming pushes triggers 3 builds × N pushes. Burns CI minutes.
**Mitigation:** `concurrency.cancel-in-progress: true` at the workflow
level already cancels prior runs when a new push lands, so only the
latest commit's matrix actually completes. Matrix jobs within one run
are fine to all run.
**Decision:** Working as intended.

## LOWS

### IL1 — `extractTo()` doesn't handle archive types beyond tar-gz / tar-xz

**Where:** Returns rejected promise for `'zip'`. Currently only used
for non-Windows where the archive is always tar.gz or tar.xz.
**Decision:** Acceptable. If we ever want to use the in-app bootstrap
on Windows too (for soft-fail recovery without going through the
existing CliService.install path), add zip support via PowerShell
Expand-Archive shell-out.

### IL2 — Bootstrap doesn't clean up partial extracts on failure

**Where:** If extract succeeds but flatten fails, the user has a
half-flattened `runtime/` dir. Re-running bootstrap should succeed
(extract uses `-Force`-equivalent and flatten removes existing dst
files).
**Decision:** Acceptable; re-run recovers.

### IL3 — `RELEASE_NOTES_v2.0.0.md` references file paths that don't
exist yet (e.g. `latest-mac.yml`)

These will exist after the first `npm run dist:mac` publish. Cosmetic
forward-reference.

## Risks accepted (carried forward from v1.1)

- Code-signing absence (IH3 — all platforms now).
- Trust delegation to Anthropic npm + nodejs.org HTTPS.
- Online-only bootstrap (no offline variant).
- Best-effort `claude doctor` parsing.

## Plan adjustments

1. **CI matrix outcome → V1+V2 validation:** if CI's mac/linux jobs
   pass, that satisfies V1 (build green) for those platforms.
   Functional test on each OS is still required for V2.
2. **BACKLOG add:** shared `node-pin.json` module so NSIS script +
   CliService stay in sync on Node version bumps (IM3).
3. **BACKLOG add:** linux-arm64 + macOS pre-Apple-Silicon (10.13)
   support based on demand (IM4).
4. **Phase 5 (branding) still deferred** — NSIS defaults + macOS DMG
   defaults + Linux mime icon defaults all look OK for v2.0.

## v2.0 acceptance summary

- ✅ Cross-platform path resolution via `runtime-paths.ts`.
- ✅ macOS + Linux in-app Node bootstrap (download + SHA verify +
  extract via OS `tar`).
- ✅ electron-builder.yml has mac (DMG + zip) + linux (AppImage + deb +
  rpm) targets.
- ✅ package.json scripts: `dist:mac`, `dist:linux`, `dist:all`, and
  per-OS publish.
- ✅ CI matrix builds all 3 OSes; per-OS artifact upload.
- ✅ Per-OS README install sections.
- ✅ RELEASE_NOTES_v2.0.0.md updated for multi-OS.
- ✅ CONTRIBUTING.md codifies the platform-parity rule.
- ✅ Version bumped to 2.0.0-dev.1 throughout.
- ⚠️ Functional verification on each OS pending (CI green + per-OS
  smoke test per checklist).
- ⚠️ Code-signing deferred to v2.1.
