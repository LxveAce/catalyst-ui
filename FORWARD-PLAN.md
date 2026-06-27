# LxveAce/catalyst-ui - Forward Plan

> Status: v4.0.3, healthy / green CI, actively releasing. Health: GREEN. Last synthesized: 2026-06-27 (update on each session).

## Where this stands

Catalyst UI (formerly "Claude Code Studio", renamed at v4.0.0) is a cross-platform **Electron 42 + React 19** desktop "multi-vendor AI workbench". It embeds Claude Code in an xterm/node-pty terminal and adds sidebar panels for Hugging Face, Ollama, multi-provider API keys (OpenAI/Gemini/OpenRouter), GitHub, resource monitoring, cost tracking, Compact optimization, Notes/Brain, accessibility, and cloud sync.

- **Layout**: main process in `src/main/*.ts` (~46 service modules; `index.ts` is the ~1930-line IPC/bootstrap hub with lazy singleton getters), renderer in `src/renderer` (React TSX panels), preload bridge in `src/preload/preload.ts`.
- **Two build pipelines**: dev = electron-forge + plugin-vite (`npm start`); distribution = standalone `scripts/build-vite.mjs` -> electron-builder (`npm run dist` / `dist:mac` / `dist:linux`). `package.json` main = `.vite/build/index.js`.
- **Toolchain**: Node `>=22 <24` (Node 24 breaks electron-builder). node-pty patched at postinstall (`scripts/patch-node-pty.js`, Windows-only) then electron-rebuilt. Windows dist needs Developer Mode ON + VS2022 C++ + Win SDK.
- **Current state**: Latest release **v4.0.3** (2026-05-28), matches `package.json`. Project CI (`ci.yml`) and Release (`release.yml`) both consistently green. Zero GitHub issues. 4 open Dependabot PRs (#16-19, CI green). **node_modules is NOT installed locally** (verified) - the local tree is not build-ready until `npm install` runs.
- **Unreleased work on master**: terminal-profiles + Catalyst Brain feature work is committed but **untagged** (bound for v4.1).
- **Cross-repo**: dev/staging twin `catalyst-ui-testing` holds byte-identical `src/` plus the full doc set (STATUS, HANDOFF, BACKLOG, security-reviews, journals). Develop in -testing, promote code-only overlay to public catalyst-ui on release.

## P0 - do first

1. **Install deps before anything**: `npm install` in `C:\Users\mmrla\repos\catalyst-ui` - `node_modules` is MISSING (verified `ls node_modules` -> MISSING). Build/typecheck/release all fail until this runs. Use Node 22.
2. **Decide the v4.1.0 cut** (the repo's biggest open state question): terminal-profiles + Catalyst Brain are on master but UNTAGGED (HANDOFF section 7.4). Either bump version + CHANGELOG + tag `v4.1.0` + run `release.yml`, or explicitly defer with a note. Don't leave shipped-but-untagged work ambiguous.
3. **Fix the v4.0.3 release-body 404**: release body points to `RELEASE_NOTES_v4.0.3.md`, which does NOT exist on master (verified - `docs/` has RELEASE_NOTES only up to v4.0.0). Either commit the file or repoint the release body to `docs/RELEASE_NOTES_v4.0.0.md`.

> Note on the installer issue: for this repo the equivalent of the "cyber-controller .exe/installer" concern is the **macOS auto-update feed** (see P2 surface bug) - the Windows `.exe`/Linux installers download fine (byte-range GET HTTP 206 confirmed), but the mac update channel is inconsistent. Address it before advertising auto-update on mac.

## Surface bugs found

| Title | Location | Severity | Note |
|---|---|---|---|
| macOS auto-update non-functional (latest-mac.yml is dmg-only, no .zip) | electron-builder.yml mac.target (65-80); release asset latest-mac.yml; README.md:147 | P2 | electron-updater needs a .zip for Squirrel.Mac. Config intentionally disabled auto-update, yet latest-mac.yml still ships + README claim has no mac caveat. Drop the feed + caveat README, or add a zip target. |
| Brain write-path symlink-escape guard is lexical only (no realpath) | Brain write guard, per SECURITY_REVIEW_BRAIN_P1.md M-1 (HANDOFF 9.1) | P2 | path.resolve + startsWith(root+sep) with no realpath(); symlink inside Brain could redirect writes out. Known/deferred. Harden before autonomous Brain writes. |
| No PTY-lifecycle (spawn->exit->resize) test harness | Test gap; STATUS.md "What's next" #1, HANDOFF 7.6 | P2 | The v4.0.3 "Cannot resize a pty that has already exited" crash shipped in v4.0.2 due to this gap. Add a smoke test. |
| Duplicate `## [4.0.2]` header in CHANGELOG.md | CHANGELOG.md lines 57 and 110 (verified) | P3 | Two 4.0.2 entries. Deferred (HANDOFF 7.5) - do not silently renumber published history; owner's call. |
| GitHub "Dependabot Updates" infra job fails every run | .github/dependabot.yml MISSING (verified) | P3 | 7 consecutive failures; project CI passes on same PRs. Add dependabot.yml or disable the job. |
| Stale `claude-code-studio` slug in ci.yml failure-log URLs | .github/workflows/ci.yml lines 168, 190 (and artifact name 206) | P3 | Cosmetic; actual push uses ${{ github.repository }}. Surfaces only on failed build. |
| Stale source-comment line reference in build-vite.mjs | scripts/build-vite.mjs lines 36-37 (verified) | P3 | Comment says loadFile else-arm at index.ts:202; actual is index.ts:294-298. Doc drift only. |
| Model-count inconsistency: README 41 vs site 33 | README.md lines 65-66 (verified); lxveace.com | P3 | Reconcile the catalog count between README and website. |
| Resource Monitor "Claude NaN%" RAM on Linux | src/main/resource-monitor.ts (mem_rss undefined -> NaN); BACKLOG section 3 | P3 | Documented; fix status unconfirmed. Needs `||0` + unit check; verify before closing. |
| Terminal resize-loop when sidebar narrows window | TerminalPanel.tsx ResizeObserver/fit; BACKLOG 482-535 (branch fix/terminal-resize-loop) | P3 | Fixed on Linux (fitIfChanged + min-width:0 + proposeDimensions gating); needs Windows re-confirm + verify branch landed on master. |

## Features to add

> No explicit user directives were supplied for this plan. The items below are the carried-forward backlog from the -testing docs.

- **v4.1.0 release (headline)** - tag/ship the terminal-profiles + Catalyst Brain work already on master (HANDOFF 7.4).
- **BACKLOG #1** - Per-provider API key UI (scoped in -testing docs).
- **BACKLOG #2** - macOS code signing + notarization (ties into the mac auto-update fix; app currently unsigned).
- **BACKLOG #3** - Model comparison view.
- **BACKLOG #4** - Embedding/RAG over sessions: **largely already realized by Brain P3** (`src/main/brain-index.ts`, Ollama `/api/embeddings`, vectors in `userData/brain-index.json`, HANDOFF 4.B). Reconcile/close rather than rebuild.
- **BACKLOG #5** - Per-model VRAM tracking.
- **Dependabot triage** - merge or close PRs #16-19 (undici, vite 8.0.16, js-yaml, form-data); their CI is green.

## Red-team / hardening

This repo is PUBLIC - frame all items as responsible hardening; do not publish exploit recipes.

- **Brain write-path containment**: replace the lexical guard with a `realpath()`-based check (resolve symlinks before the `startsWith(root+sep)` test). Mandatory before autonomous model writes. (SECURITY_REVIEW_BRAIN_P1.md M-1)
- **macOS integrity**: app is unsigned (`hardenedRuntime:false`, `identity:null`). Pair the auto-update fix with signing + notarization (BACKLOG #2) so updates are verifiable; until then document mac auto-update as disabled honestly.
- **Vault-sync exfil boundary**: confirm compact-controller vault-sync only targets the intended private repo and never leaks `~/.claude` state to public.
- **API-key handling**: audit at-rest storage of multi-provider keys (OpenAI/Gemini/OpenRouter/HF/GitHub) and ensure keys never reach logs, CI `build.log`, or the `ci-logs` orphan branch.
- **PTY command construction**: audit pty-manager spawn paths for unsanitized shell interpolation (the app embeds a live terminal; patch-node-pty.js already strips winpty + SpectreMitigation).

## Dig deeper (next dedicated session)

1. Deep-audit the 46 main-process services not covered by surface scan - prioritize `github-service`, `pty-manager`, `cloud-sync`, `huggingface-service`, `compact-controller.ts`, `brain-index.ts` for crash-prone logic/error handling (only `index.ts` coupling was reviewed).
2. Add the PTY-lifecycle smoke harness (spawn->exit->resize + resize-during-exit race) - bug prevention + coverage; would have caught the v4.0.2 crash.
3. Confirm fix status of the two carried BACKLOG bugs in real code: `TerminalPanel.tsx` (resize-loop; did `fix/terminal-resize-loop` land? re-confirm Windows) and `resource-monitor.ts` (Linux Claude-NaN-RAM).
4. Read the -testing planning docs not yet opened: `MULTI_PROVIDER_BRAINSTORM.md`, `OBSIDIAN_INTEGRATION.md`, `INSTALLER_REDESIGN.md`, `PLAN_2026-05-2x_*.md`, `SESSION_LOG_*.md`, `docs/security-reviews/*`.
5. Verify standalone `claude-compact-controller` vs `src/main/compact-controller.ts` have not drifted on the on-disk schema.
6. Run a full local build end-to-end after `npm install` (typecheck + build-vite + electron-builder) - never confirmed locally, only inferred from CI.
7. Inspect the `obsidian-plugin/` subproject - is it a second buildable artifact with its own open work?

## Dependencies & cross-repo context

- **Toolchain pin**: Node `>=22 <24` (CI uses 22.22.3). Windows dist needs Developer Mode ON + VS2022 C++ + Win SDK (node-pty + winCodeSign symlinks).
- **node-pty**: `scripts/patch-node-pty.js` (postinstall, Windows-only) strips winpty cmd-invocations + SpectreMitigation; DLLs asarUnpacked; `npmRebuild:false`.
- **Twin repo**: `C:\Users\mmrla\repos\catalyst-ui-testing` = dev/staging copy with byte-identical `src/` (verified) plus the full doc set. **Plan/continuity lives in -testing docs, not git log.** Develop in -testing, promote code-only overlay to public catalyst-ui. Respect `AGENT_COORDINATION.md` claim protocol (multi-agent/multi-machine).
- **Predecessor**: `claude-compact-controller` (standalone) is the origin of the integrated Compact panel; shares the on-disk contract (`~/.claude/compact-controller/state.json`, `vault/`, `~/.claude/settings.json` hooks) with `src/main/compact-controller.ts`.
- **Rebrand continuity**: appId `com.lxveace.claude-code-studio` + userData dir deliberately preserved for in-place upgrade; `release.yml` accepts both `Catalyst-UI-*` and `Claude-Code-Studio-*` artifact globs. "Claude Code Studio" still appearing in CHANGELOG/some docs is intentional history, not a bug.
- **History**: both repos squashed to one PII-scrub commit ("Scrub legal name and personal email; attribute to alias"). Public-profile rules: alias attribution, no PII, no Claude co-author on public commits.
- **Links**: https://github.com/LxveAce/catalyst-ui | https://lxveace.com

## Open questions

- Is the v4.1 work (terminal-profiles + Brain) meant to ship now or deliberately held? Needs owner go/no-go.
- Are Dependabot PRs #16-19 left open by policy or just un-triaged?
- Do the local clones match origin? Single-commit (squashed) history blocks diffing against upstream; old HANDOFF commit hashes won't resolve.
- Has `fix/terminal-resize-loop` landed on master, and is the fix confirmed on Windows?
- Is the Linux Resource Monitor Claude-NaN-RAM bug still present in current `resource-monitor.ts`?
- Should `latest-mac.yml` keep being published given mac auto-update is intentionally disabled, or be dropped to remove the broken feed?
- Is `obsidian-plugin/` a second buildable artifact with its own open work, or inert?