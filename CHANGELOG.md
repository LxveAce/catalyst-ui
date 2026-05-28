# Changelog

All notable changes to Claude Code Studio. Dates are when the tag was
pushed to origin. Detailed per-release notes live in
`docs/RELEASE_NOTES_v{version}.md` and are attached to each GitHub
release; this file is the at-a-glance summary.

The project follows [semver](https://semver.org/) loosely — major bumps
mean breaking install/migration changes (v1 → v2 = Squirrel → NSIS;
v2 → v3 = multi-model surface).

---

## [3.2.0] — 2026-05-28

First public update since v3.0.0. v3.1.0 existed only as an internal
testing release; v3.2.0 brings the full set of v3.1.0 + v3.2.0 features
to the public repo in a single promotion commit.

Full per-release detail in `docs/RELEASE_NOTES_v3.2.0.md`.

### Added
- **Terminal Tabs** (replaces split-pane layout). Windows-Terminal-style
  strip with `+` button → new Claude tab, `▼` profile picker → catalog
  dropdown, ↗ popout, × close per tab. Session schema bumped v1→v2 with
  automatic migration (old layouts become a single Claude tab on the
  same paneId so any live PTY reattaches).
- **Claude (Chat) profile** — runs the CLI in `--print
  --input-format=stream-json --output-format=stream-json --verbose`
  bidirectional JSONL mode. New `json-stream-parser.ts` turns SDK events
  into chat bubbles; renders `tool_use`, `tool_result`, and `thinking`
  content blocks as cards with paired correlation badges.
- **Stop button** replaces Send while a chat-mode response streams —
  sends SIGINT to halt generation.
- **CLI capability probe** at app launch runs `claude --help` and
  badges the Claude (Chat) entry with a yellow "CLI flags?" pill if the
  local binary doesn't appear to support stream-json.
- **Commands sidebar mirrors active tab** — six command families
  curated (Claude / Ollama / Aider / Gemini / BitNet / unknown).
  Header chip announces which CLI's commands are showing. Quick Action
  "starter" commands (Aider `/add `, Ollama `/set system `) land in
  composer without auto-submitting an empty argument; the active
  terminal auto-focuses.
- **Chat-skin v2** — Claude.ai-style layout (persona header, soft
  rounded bubbles for both roles, pill composer with circular gradient
  send button), markdown rendering via `react-markdown` + `remark-gfm`
  + Prism syntax-highlighted code blocks. Aggressive sanitizer detects
  TUI screen-clear sequences and starts a new assistant message instead
  of appending. `InteractivePromptBanner` callout when the CLI is
  asking for an Enter/Esc choice.
- **GPU routing** for the Ollama daemon — ModelsPanel hardware banner
  has an Auto / Force GPU / Force CPU picker; with multiple dedicated
  GPUs a second dropdown picks which one. Routing env vars
  (`CUDA_VISIBLE_DEVICES`, `HIP_VISIBLE_DEVICES`, `OLLAMA_VULKAN`,
  …) are injected on `ollama serve` startup — fixes "my dedicated GPU
  is ignored" which previously came from env being attached to the
  wrong process.
- **Auth auto-detect** — Settings → API keys now surfaces existing
  Claude CLI OAuth (`~/.claude.json`) and shell env vars
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) alongside keys stored
  via safeStorage. Colored tags: green "CLI OAuth", blue "env var",
  purple "saved". Button label switches to "Override" when an
  external source is in play.
- **Catalog**: BitNet b1.58 2B (Microsoft, via the bitnet.cpp runner —
  flagged), Liquid AI LFM2.5 350M + 1.2B Instruct (via
  `hf.co/LiquidAI/*:Q4_K_M`), new `'jetson-thor'` hardware tier
  (workstation-equivalent compute; 28 workstation-class entries tagged
  with it).
- **Runtime verifier** (`scripts/runtime-verify.mjs`) — CDP-driven
  smoke harness. v3.2.0 extended it from 12→30 assertions covering tab
  add/close, profile picker open + Esc, palette open + Esc, family
  chip text on tab switch.
- **Installer chrome** — modernized NSIS wizard mode
  (`oneClick: false`), BMP header + sidebar via accent-purple gradient,
  optional Ollama install prompt during setup (`MessageBox MB_YESNO`).

### Changed
- `SplitLayout.tsx` removed. The pre-v3.2.0 split-pane layout is no
  longer available; sessions migrate to a single Claude tab.
- `package.json` engines now require Node ≥ 22, < 24.

### Fixed
- StatusBar PID readout now works for model tabs (was 0).
- `EmbeddedTerminal` sender plumbing — palette / snippet text now
  reaches model PTYs.
- CLI onboarding routes `/login` to a Claude tab when the active tab
  is a non-Claude model (was sending the slash command to whichever
  PTY was active, confusing ollama / aider).
- Chat-mode echo dedup uses whitespace-normalized comparison so
  Claude's internal text normalization doesn't double-render user
  messages.
- Local AI launch on Windows — new `cli-resolver.ts` finds
  `ollama.exe` / `gemini.cmd` / `aider.exe` from well-known install
  dirs + `where.exe` before passing to node-pty. node-pty does
  CreateProcess directly without a shell, so bare `ollama` was
  failing.
- Atomic writes for `cli-flags.json` + compact-controller `config.json`
  (were non-atomic `writeFileSync`).
- Sidebar buttons gained `aria-label` + `data-panel` for screen
  readers + automation.

### Notes
- **v3.1.0 was a testing-only internal release.** v3.2.0 is the first
  public update after v3.0.0; the v3.1.0 features are folded in.

---

## [3.0.0] — 2026-05-26

The multi-model release. Local + API model catalog, file directory
navigator, accurate per-bucket resource monitoring, cross-platform
uninstall flow, and the full beta.1 → beta.2 → beta.3 fix log folded
into one stable.

### Added
- **Multi-model catalog** — 33 curated local + API models (Qwen,
  DeepSeek, Llama, Gemma, Granite, Phi, Mistral, embeddings) with
  hardware-aware recommendations + cwd-aware project suggestions.
- **Ollama integration** — in-app detection, pull with streaming
  progress, cancel, delete. Install prompt links to `ollama.com/download`
  (not bundled in the installer).
- **In-panel terminal viewer** for launched models + **pop-out windows**
  (separate `BrowserWindow` per model).
- **First-run picker** — auto-opens after install with top
  recommendations for your hardware.
- **File directory navigator** — new sidebar panel, lazy folder tree,
  recent projects, show/hide dotfiles, path-traversal guarded.
- **Add custom model form** — register your own model in the registry.
- **License disclosure** for restricted-license models (Llama, Gemma,
  BigCode) before pull.
- **Per-bucket resource monitoring** — Claude / Models / Ollama tracked
  separately; O(n) process-tree walk (was O(n²)).
- **`--dangerously-skip-permissions` toggle** in Settings → Claude CLI.
  Auto-injects the flag when spawning Claude; never affects model PTYs.
- **Danger Zone in Settings** — Reset User Data (wipes JSON state files,
  keeps Chromium profile) + Uninstall (cross-platform: Windows NSIS,
  macOS Finder, Linux pkg-mgr hint).
- **Status bar git branch** with dirty indicator.
- **App version IPC** — title bar, status bar, and About row all read
  from `app.getVersion()` (no more hardcoded drift).
- **NSIS uninstaller** prompts to also remove userData JSON.

### Changed
- Cost rates updated to May 2026 Anthropic pricing (Haiku $1/$5, was
  $0.8/$4). Sonnet $3/$15 and Opus $15/$75 unchanged.
- Cost disclaimer made explicit: local models via Ollama are free and
  never counted.
- GitHub Octokit errors classified into friendly one-line messages
  (401 token revoked / 403 rate limit with reset time / 404 / network).
- Sign-in flow now sends `/login` (Claude's in-session slash command)
  instead of `claude login` (which the running Claude session was
  treating as chat text).
- `CliService.getStatus` heuristic loosened — only flips `authenticated:
  false` when stderr explicitly mentions auth phrases (was failing on
  any non-zero `claude doctor` exit, popping the modal needlessly).
- Auto-updater skips beta builds entirely (no more `latest.yml` 404
  stack trace).

### Removed
- Ollama bundle from the NSIS installer (was downloading ~2 GB silently
  with no progress UI — users thought the installer was stuck). In-app
  detection + opt-in install link replaces it.

### Known deferred (own pushes later)
- Per-provider API key entry (OpenAI, Gemini, OpenRouter)
- Model comparison view (parallel pane + synced input + diff)
- Embedding-RAG over past sessions
- Per-loaded-model VRAM tracking (requires vendor GPU SDKs)
- macOS code signing + notarization

---

## [2.0.0] — 2026-05-24

Cross-platform release. Windows + macOS + Linux from a single source
tree.

### Added
- macOS DMG (Apple Silicon native, Intel via Rosetta)
- Linux AppImage (portable, any distro) + .deb (Debian/Ubuntu) + .rpm
  (Fedora/RHEL)
- Cross-platform first-launch Node + Claude CLI bootstrap (macOS/Linux
  uses in-app modal; Windows uses NSIS install-time download)
- Per-OS README install sections + SmartScreen/Gatekeeper workarounds

### Changed
- Build pipeline migrated from electron-forge + Squirrel → electron-
  builder + NSIS (Windows) / DMG (Mac) / AppImage/.deb/.rpm (Linux)
- Auto-updater migrated from `update-electron-app` (Squirrel-tied) to
  `electron-updater` (cross-platform via `latest.yml`)
- Tag-driven CI release workflow (matrix build on push of `v*.*.*`)

### Fixed
- npm install MODULE_NOT_FOUND node-gyp/bin/node-gyp.js (added
  `--ignore-scripts` to the bootstrap npm install)
- Sign In button submit (PTY readline needs `\r`, not `\n`)
- Vite `path.join is not a function` browser-stub crash (added explicit
  `external: [...builtinModules]` to vite.main.config)

### Migration from v1
v1 used Squirrel.Windows for Windows-only delivery. v2 uses NSIS which
doesn't know about Squirrel's metadata. v1 users: uninstall via Windows
Settings → Apps, then run the new installer. See
`docs/MIGRATING_FROM_V1.md`.

---

## [1.0.0] — initial release

Single-platform (Windows) Electron app wrapping the Claude Code CLI in
an embedded terminal (node-pty + xterm.js). Resource monitor, GitHub
panel, compact-controller integration, LMM journaling panel,
auth/sync, snippets, hotkeys, system tray.

Built with electron-forge + Squirrel.Windows. Auto-updates via
`update-electron-app`.
