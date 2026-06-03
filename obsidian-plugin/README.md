# Catalyst Brain Bridge (Obsidian plugin)

First-party companion plugin for **Catalyst UI**'s Brain (P5 of the Obsidian
integration). It makes the Brain "show up inside Obsidian too" — built on the
**MIT-licensed `obsidian` type stubs** (the stubs are MIT even though the
Obsidian app is proprietary; this plugin ships no Obsidian code).

## What it does

- **Tag a note for Catalyst** — command + ribbon icon that sets
  `catalyst_brain: true` in the note's frontmatter (via the public
  `processFrontMatter` API). Catalyst's mirror/index can prioritize tagged notes.
- **Status bar** — shows how many notes are Catalyst-tagged.
- **Settings tab** — a reminder of which folder Catalyst points its Brain at.

No network, no embedding of Catalyst — the two cooperate purely through the
shared `.md` files (Catalyst's Brain Folder Service reads/writes the same
folder). A future version can call a Catalyst inbound endpoint once one exists.

## Build

This is a standalone project (kept out of the main app's TypeScript build):

```bash
cd obsidian-plugin
npm install
npm run build        # type-checks, then bundles main.ts → main.js
```

## Install into a vault

Copy `manifest.json`, `main.js`, and (optionally) `styles.css` into:

```
<your vault>/.obsidian/plugins/catalyst-brain-bridge/
```

Then enable **Catalyst Brain Bridge** in Obsidian → Settings → Community plugins.

> Point Catalyst UI's Brain at the **same vault folder** and the two work
> together: tag notes here, query/edit them from Catalyst.
