# Claude Code Studio v3.2.0

**Released:** 2026-05-27 (testing repo)
**Theme:** Tab-based terminal + structured chat-mode

---

## Headline features

### Terminal Tabs (replaces split-pane layout)

A Windows-Terminal-style tab strip is now the primary terminal UX.
The previous split-pane layout from v3.x is gone.

- `+` button → new Claude tab.
- `▼` profile picker → catalog dropdown grouped API / Local. Pick any
  model (Claude, Ollama, Aider, Gemini, BitNet) → spawns its CLI in
  a new tab.
- Tab strip: status dot · label · ↗ popout · × close per tab.
- Tabs can be popped out into separate windows (PTY stays alive in
  the main window's tab).
- Session schema bumped v1 → v2. Existing sessions migrate cleanly
  on first launch — the first pane from your old layout becomes a
  single Claude tab on the same paneId so any alive PTY reattaches.
- Renderer-side cap at 32 tabs (matches main-side `MAX_TABS`).
  Past the cap, a dismissable yellow notice tells you to close a
  tab first.

### Claude (Chat) profile — structured JSON conversation

New catalog entry that runs the Claude CLI in non-interactive
bidirectional JSONL mode (`--print --input-format=stream-json
--output-format=stream-json --verbose`). Pairs with the ✦ Chat
overlay to produce a real chat UI — no more TUI repaint sequences
getting garbled into the chat skin.

- Pick **Claude (Chat)** from the `▼` picker (now appears alongside
  the bundled Claude entry).
- Toggle ✦ Chat skin → structured rendering of all Claude event
  types: text bubbles, tool_use cards, tool_result cards, thinking
  blocks.
- Tool cards show a `#abc123` correlation badge that matches across
  paired tool_use ↔ tool_result calls.
- Stop button replaces the Send button while a response streams —
  sends SIGINT to halt generation.
- New capability probe: on app launch we run `claude --help` and
  badge the **Claude (Chat)** entry with a yellow "CLI flags?" pill
  if your local Claude binary doesn't appear to support stream-json.

### Commands sidebar mirrors the active tab

The Commands panel (Quick Actions / All Commands / Shortcuts) now
follows the active terminal tab's CLI. Six command families
curated: Claude / Ollama / Aider / Gemini / BitNet / Terminal-unknown.

- Header chip ("CLAUDE", "OLLAMA", "AIDER", …) announces which CLI
  the panel is showing commands for.
- Quick Actions with trailing-space "starter" commands (Aider
  `/add `, `/drop `, etc.; Ollama `/set system `) now land in the
  composer *without* auto-submitting an empty argument; the active
  terminal auto-focuses so you can finish typing.
- Click any command → routes to the active tab's PTY via the same
  sender registry that snippets and the palette use.

### Runtime verifier upgraded

`node scripts/runtime-verify.mjs` now runs **30 assertions** instead
of 12:
- 12 sidebar panel renders (boot + each panel switch, no console
  errors).
- 18 extended assertions covering tab add/close, profile picker
  open + Esc-close, Commands family chip text, Ctrl+Shift+P palette
  open + Esc-close.

Used as the smoke gate for every PR in this release.

---

## Smaller wins

- **Model tab PID footer**: StatusBar PID readout now works for
  model tabs (it harvests the pid from `models.listRunning()` on
  attach). Previously showed 0.
- **EmbeddedTerminal `registerSender`** wired through, so palette /
  snippet text injection actually reaches model PTYs.
- **CLI onboarding** routes `/login` to a Claude tab when the active
  tab is a non-Claude model (otherwise it'd type `/login` into
  ollama / aider and confuse).
- **Echo dedup** in the chat-mode renderer uses whitespace-normalized
  comparison, so Claude's internal text normalization doesn't cause
  user messages to render twice.
- **Tool-input summary** field-priority list expanded to 18
  candidates (catches Anthropic SDK conventions: `target_file`,
  `cmd`, `q`, `instruction`, etc.).
- **Tool-result image hints** show `media_type` + source kind +
  approximate size: `[image: image/png, base64, ~24 KB]` instead of
  bare `[image]`.

---

## What's NOT in this release (deferred)

Two Mediums explicitly classified as cosmetic by their original
red-teams:
- `closeTab` focus fallback uses a closure-captured tabs array
  (narrow timing window; persistence layer corrects).
- Commands panel content swaps instantly on tab switch (no fade
  animation).

Various Lows tracked per-review remain deferred per category L
policy.

---

## Verification

- `npx tsc --noEmit` clean.
- `npx vite build` clean.
- `node scripts/runtime-verify.mjs` 30/30 passing.
- 5 separate security reviews (`docs/security-reviews/`) with all
  H+M findings closed in-release.
- **Visual smoke against a real Claude binary is recommended** for
  the chat-mode + tool-use + Stop button paths — the verifier
  exercises the renderer but doesn't drive Claude itself.

---

## Upgrade notes

- **Session file migration is automatic.** v1 sessions become a single
  Claude tab on the first pane's id.
- **Settings unaffected.** Themes, hotkeys, snippets, GitHub PAT, etc.
  all persist across the upgrade.
- **Local model tabs are session-ephemeral by design** — only Claude
  tabs persist across restart. Open your Ollama / Aider models again
  from the picker after upgrade.

---

## Pull requests in this release

10 stacked PRs merged together (#18–#27 on the testing repo):

| PR | Title |
|---|---|
| #18 | feat(tabs): wire TerminalTabs into App + session schema v2 |
| #19 | feat(commands): mirror active tab profile + register EmbeddedTerminal sender |
| #20 | feat(chat-mode): Claude --stream-json profile + JSONL parser |
| #21 | chore(polish): submit flag for starter commands + MAX_TABS cap |
| #22 | feat(chat-mode): render tool_use / tool_result / thinking blocks |
| #23 | fix(embed): surface model PTY pid for StatusBar |
| #24 | feat(chat-mode): Stop button replaces Send while streaming |
| #25 | feat(cli): `claude --help` capability probe + picker badge |
| #26 | chore(tool-use): pairing badge + richer summary fields + image hint |
| #27 | chore(polish): capNotice + auto-focus + dedup + onboarding routing |
