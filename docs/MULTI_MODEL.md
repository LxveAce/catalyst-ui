# Multi-model catalog (v3.0)

**Status:** Built. Landed on `feature/multi-model-scaffold` on 2026-05-26.

This doc covers the why + what + how of the multi-model catalog. The
33-model seed data lives in `src/main/model-catalog-seed.ts`; that file
is the source of truth for model facts (sizes, licenses, strengths).
This doc is for the architecture around it.

---

## Why this exists

Studio shipped wrapping a single CLI (Anthropic's `claude`). Users on
modern hardware can run real coding models locally for free — Qwen2.5
Coder 32B at Q4 is at Claude Sonnet 3.5 quality on single-file work as
of May 2026, and runs on a 24 GB consumer GPU. There is no good reason
to keep the GUI single-model when the underlying PTY abstraction can
spawn anything.

The catalog gives users:

1. A curated list of what's actually worth running locally (not just
   "everything on the Ollama library").
2. Hardware-aware recommendations so a 16 GB laptop user doesn't try
   to pull a 70B model and watch it OOM.
3. License visibility — some popular models (Llama, Gemma) have
   commercial-use restrictions that matter for app distribution.
4. Project-aware suggestions — a Python/Django repo should surface
   different defaults than a React/Tailwind project.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Renderer: ModelsPanel.tsx                           │
│   filters, search, recommendations, pull/launch UI  │
└────────────┬────────────────────────────────────────┘
             │ electronAPI.models / .ollama / .hardware
             ▼
┌─────────────────────────────────────────────────────┐
│ Main (index.ts wires these together)                │
│                                                      │
│  ModelRegistry         OllamaService                │
│   - 33-model seed       - detect (PATH + dirs)      │
│   - persist user        - list installed            │
│     additions           - pull (streaming progress) │
│   - recommend()         - cancel / delete           │
│                                                      │
│  HardwareDetection     ProjectLanguageDetect        │
│   - RAM / GPU probe     - cwd → frontend/backend/   │
│   - tier classify         data/etc.                 │
│                                                      │
│  PtyRegistry (generalized)                          │
│   - now accepts arbitrary command + args            │
│   - spawned with model.command + model.args         │
│   - paneId = "model:<id>-<timestamp>"               │
└─────────────────────────────────────────────────────┘
```

### Files added this push
- `src/main/model-catalog-seed.ts` — 33-model curated catalog
- `src/main/ollama-service.ts` — CLI wrapper (detect / list / pull / delete)
- `src/main/hardware-detection.ts` — RAM/VRAM probe + tier classifier
- `src/main/project-language-detect.ts` — cwd → project role(s)

### Files modified this push
- `src/main/model-registry.ts` — uses seed, adds recommend() algorithm
- `src/main/pty-manager.ts` + `pty-registry.ts` — accept arbitrary command/args
- `src/main/index.ts` — wires new services + IPC handlers
- `src/shared/types.ts` — expanded `ModelDefinition` with catalog metadata
- `src/shared/ipc-channels.ts` — added Ollama / hardware / project channels
- `src/preload/preload.ts` — exposed new namespaces
- `src/declarations.d.ts` — ambient types for new namespaces
- `src/renderer/components/models/ModelsPanel.tsx` — full UI rewrite
- `build/installer.nsh` — Ollama bootstrap (detect + curl install)

A timestamped backup of all 15 modified files lives at
`_backups/2026-05-26-pre-fullscope/`.

---

## The recommend() algorithm

`ModelRegistry.recommend(hardware, project)` returns up to 12 ranked
local models with a `reason` string each. Scoring is additive:

| Signal | Score |
|---|---|
| Curated default for `role:tier` (e.g. `frontend:high` → `qwen2.5-coder:32b`) | +4 |
| Featured + role matches project's primary role | +5 |
| Any role matches project's roles | +3 |
| Featured + tier matches host tier exactly | +3 |
| Tier matches host tier exactly | +2 |
| Tier below host tier (model fits comfortably) | +1 |
| Featured (catch-all) | +1 |
| Model needs higher tier than host | −3 |
| License has commercial-use restrictions | −2 |

The defaults table lives in `model-catalog-seed.ts:ROLE_TIER_DEFAULTS`
and encodes "if no other signal applies, this is the consensus pick for
your hardware + project type." It's deliberately curated, not derived
— see the research notes in commit history for justification.

---

## Hardware tiers

The tier-classify logic in `hardware-detection.ts` favors VRAM over
RAM, because moving a model off-GPU collapses throughput.

```
workstation:  64+ GB RAM AND (48+ GB VRAM OR multi-GPU)
              → 70B at Q4-Q6, large MoE
high:         32+ GB RAM AND 16+ GB VRAM
              → 32-34B at Q4, or 70B at heavy quant
mid:          16+ GB RAM AND 8+ GB VRAM (or 24+ GB RAM with weak GPU)
              → 13-14B at Q4, or 7-8B at Q8
low:          8+ GB RAM
              → 7-8B at Q4_K_M
toaster:      anything less
              → 1-3B at heavy quant
```

---

## Ollama bootstrap (Windows installer)

NSIS `customInstall` macro (see `build/installer.nsh` step 5) probes for
Ollama at three well-known paths plus PATH via `where.exe`:

- `$LOCALAPPDATA\Programs\Ollama\ollama.exe`
- `$PROGRAMFILES\Ollama\ollama.exe`
- `$PROGRAMFILES64\Ollama\ollama.exe`

If found: log version, skip install. If absent: `curl.exe` down
`OllamaSetup.exe` from `ollama.com/download/OllamaSetup.exe` (~700 MB)
and run with `/verysilent /norestart`. Both failure modes (download
failed, installer non-zero exit) are SOFT — Studio installs anyway and
the Models panel surfaces "Ollama not installed" with an Install link.

We don't pin a SHA because Ollama's setup URL serves "latest stable" and
ships new versions monthly. The setup binary is Authenticode-signed by
Ollama, Inc., so Windows verifies the signature when the installer runs.

**Not yet shipped:** macOS + Linux installer Ollama bootstrap. The
detection + fallback logic in the panel UI is platform-neutral, so users
on those OSes just see "Ollama not installed" and install manually for
now.

---

## What still doesn't work (and why)

### In-panel xterm viewer for launched models

When you click "Launch in app" today, the PTY spawns successfully and
the paneId is registered with PtyRegistry. Data flows through the
existing `TERMINAL_DATA` IPC. **But:** the Models panel doesn't mount
an xterm for it — only the main Terminal panel does, and that's hard-
coded to one paneId per leaf in the split layout.

To fix this, the terminal-panel split system needs to know about
"external" paneIds (created by something other than the user clicking
"new pane"). Two reasonable approaches:

1. Add a "pending launches" intent to session state; the layout
   component sees it and adds a split to mount the new paneId.
2. Add an inline xterm to the Models panel itself (small, just for
   viewing). User can "move to terminal panel" if they want full
   layout integration.

Option 2 is simpler and gives more immediate value. Probably the next
follow-up.

### Pop-out windows

Was in the original brainstorm. Pop-out needs:
- New `BrowserWindow` per model
- IPC routing per window (the preload script + handlers work the
  same, but each window needs its own session of subscriptions)
- Window lifecycle management
- Cross-window state for "this model is open in window 2"

Maybe ~1-2 weeks of focused work. Tracking but not building this push.

### Per-provider API key entry

The API tab today only knows about Anthropic's `claude`. To add OpenAI,
Gemini, OpenRouter etc., we need:
- Auth UI generalization (existing `AuthPanel` is Anthropic-specific)
- Per-provider credential storage via `safeStorage`
- Provider-specific CLI shimming

Not in this push — the catalog has slots for these but no UI to enter
keys yet.

### "Add custom model" form

`ModelRegistry.add()` is wired and the IPC is exposed via
`electronAPI.models.add()`. There's no UI form yet. A power-user could
add a model via DevTools today. The button is intentionally absent
because a forgiving UI here is meaningful work and the seed catalog
already covers most legitimate use cases.

---

## How to extend the catalog

Edit `src/main/model-catalog-seed.ts`. The schema is in
`src/shared/types.ts:ModelDefinition`. Bump `SEED_VERSION` in
`model-registry.ts` if you add models — the registry will merge
additions into existing user catalogs without clobbering user edits.

Minimum required fields for a new entry:
```typescript
{
  id: 'ollama.your-model',
  name: 'Your Model Name',
  category: 'local',
  provider: 'Ollama',
  command: 'ollama',
  args: ['run', 'your-model:tag'],
  ollamaName: 'your-model:tag',
}
```

To be useful in the catalog UI, also add: `paramsB`, `vramGB`,
`contextTokens`, `license`, `roles`, `hardwareTiers`, `recommendedFor`.

To get into the "Recommended" section, set `featured: true` and add a
short `badge`. Reserve this for genuine consensus best-in-class picks
— if everything is featured, nothing is.

---

## Catalog snapshot (May 2026)

33 models across 9 role-categories and 5 hardware tiers. See the seed
file for the full list. Headline picks per tier per the research:

| Tier | General | Coding | Reasoning | Vision |
|---|---|---|---|---|
| toaster | llama3.2:3b | — | — | — |
| low | qwen3:8b | qwen2.5-coder:7b | deepseek-r1:8b | qwen2.5vl:7b |
| mid | qwen3:14b | qwen2.5-coder:14b | deepseek-r1:14b | qwen2.5vl:7b |
| high | qwen3:32b | qwen2.5-coder:32b | qwq:32b | qwen3-vl:32b |
| workstation | llama3.3:70b | qwen3-coder | qwen3:32b | qwen3-vl:32b |

These are baked into `ROLE_TIER_DEFAULTS` in the seed file — the
recommend() algorithm gives them a +4 boost so they end up first in
their context.
