import * as fsp from 'node:fs/promises';
import { BrainService, extractWikilinks } from './brain-service';
import type { BrainBacklink, BrainLinksResult, BrainOutLink } from '../shared/types';

/**
 * BrainGraph — the wikilink graph over the Brain (backlinks + outgoing-link
 * resolution). This is the Obsidian "linked mentions" graph, computed directly
 * from the `.md` files, no Obsidian needed.
 *
 * Link resolution mirrors Obsidian's shortest-path-by-basename rule: `[[Note]]`
 * resolves to a note whose basename (sans `.md`, sans `#heading`) matches,
 * case-insensitively. The whole graph is cached and rebuilt only when the note
 * set / mtimes change (cheap signature check), so per-note backlink lookups are
 * O(notes) over an in-memory map, not a fresh disk scan each call.
 */

interface OutRef {
  target: string;
  base: string;
}

interface Graph {
  signature: string;
  titles: Map<string, string>;
  /** lowercased basename → relPaths that have that basename. */
  byName: Map<string, string[]>;
  /** relPath → its outgoing wikilink refs. */
  outlinks: Map<string, OutRef[]>;
}

/** Normalize a relPath or link target to its lowercased basename key. */
function baseKey(s: string): string {
  const noHash = s.split('#')[0];
  const last = noHash.split('/').pop() ?? noHash;
  return last.replace(/\.md$/i, '').trim().toLowerCase();
}

export class BrainGraph {
  private static _instance: BrainGraph | null = null;
  static instance(): BrainGraph {
    if (!this._instance) this._instance = new BrainGraph();
    return this._instance;
  }

  private cache: Graph | null = null;

  /** Build (or return cached) graph for the current Brain folder. */
  private async build(): Promise<Graph | null> {
    const svc = BrainService.instance();
    const list = await svc.listNotes();
    if (list.error || !list.root) return null;

    const signature = list.notes.map((n) => `${n.relPath}:${n.modified}`).join('|');
    if (this.cache && this.cache.signature === signature) return this.cache;

    const titles = new Map<string, string>();
    const byName = new Map<string, string[]>();
    const outlinks = new Map<string, OutRef[]>();

    for (const n of list.notes) {
      titles.set(n.relPath, n.title);
      const b = baseKey(n.relPath);
      const arr = byName.get(b) ?? [];
      arr.push(n.relPath);
      byName.set(b, arr);
    }

    for (const n of list.notes) {
      const abs = svc.absPathFor(n.relPath);
      if (!abs) continue;
      let raw = '';
      try {
        raw = await fsp.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const refs = extractWikilinks(raw).map((l) => ({ target: l.target, base: baseKey(l.target) }));
      outlinks.set(n.relPath, refs);
    }

    this.cache = { signature, titles, byName, outlinks };
    return this.cache;
  }

  /** Backlinks + resolved outgoing links for one note. */
  async links(relPath: string): Promise<BrainLinksResult> {
    if (typeof relPath !== 'string' || relPath.length === 0) {
      return { ok: true, backlinks: [], outgoing: [], error: null };
    }
    const g = await this.build();
    if (!g) return { ok: false, backlinks: [], outgoing: [], error: 'no-brain-folder' };

    const targetBase = baseKey(relPath);
    const backlinks: BrainBacklink[] = [];
    for (const [src, refs] of g.outlinks) {
      if (src === relPath) continue;
      if (refs.some((r) => r.base === targetBase)) {
        backlinks.push({ relPath: src, title: g.titles.get(src) ?? src });
      }
    }
    backlinks.sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { sensitivity: 'base' }));

    const seen = new Set<string>();
    const outgoing: BrainOutLink[] = [];
    for (const r of g.outlinks.get(relPath) ?? []) {
      if (seen.has(r.target)) continue;
      seen.add(r.target);
      const matches = g.byName.get(r.base) ?? [];
      outgoing.push({ target: r.target, relPath: matches[0] ?? null });
    }

    return { ok: true, backlinks, outgoing, error: null };
  }
}

// Exported for unit-testing the resolution rule without Electron.
export const __test = { baseKey };
