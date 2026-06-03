import { BrainService } from './brain-service';
import type { BrainEntry, BrainWriteResult } from '../shared/types';

/**
 * BrainWriter — P2 unification bus. Serializes a canonical {@link BrainEntry}
 * to a schema-stamped Obsidian note and writes it (via BrainService, so all the
 * P1 guards — path scoping, atomic write — apply) under a managed subtree:
 *
 *   <Brain>/_catalyst/<source>/<id>.md
 *
 * Managed notes are confined to `_catalyst/` and addressed only by SLUGIFIED
 * source+id, so a hostile `BrainEntry` over IPC can never escape that subtree.
 * Re-writing the same id overwrites in place (idempotent mirroring).
 */

const MANAGED_ROOT = '_catalyst';

export function slugify(s: string): string {
  return (
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'note'
  );
}

/** `_catalyst/<source>/<id>.md` — both segments slugified (no traversal). */
export function brainEntryRelPath(entry: BrainEntry): string {
  return `${MANAGED_ROOT}/${slugify(entry.source || 'misc')}/${slugify(entry.id || entry.title)}.md`;
}

function yamlScalar(v: string): string {
  // Plain (unquoted) when safe; otherwise JSON double-quote (valid YAML).
  return /^[A-Za-z0-9 _.\/:-]+$/.test(v) && v.trim() === v ? v : JSON.stringify(v);
}

function yamlList(items: string[]): string {
  return `[${items.map(yamlScalar).join(', ')}]`;
}

/** Serialize a (sanitized) entry to a full `.md` file string. */
export function serializeBrainEntry(entry: BrainEntry): string {
  const s = sanitizeEntry(entry);
  const fm: string[] = [];
  fm.push(`id: ${yamlScalar(s.id)}`);
  fm.push(`title: ${yamlScalar(s.title)}`);
  fm.push(`source: ${yamlScalar(s.source)}`);
  if (s.type) fm.push(`type: ${yamlScalar(s.type)}`);
  if (s.project) fm.push(`project: ${yamlScalar(s.project)}`);
  if (s.created) fm.push(`created: ${yamlScalar(s.created)}`);
  if (s.updated) fm.push(`updated: ${yamlScalar(s.updated)}`);
  if (s.author) fm.push(`author: ${yamlScalar(s.author)}`);
  if (s.status) fm.push(`status: ${yamlScalar(s.status)}`);
  if (s.tags && s.tags.length) fm.push(`tags: ${yamlList(s.tags)}`);
  if (s.links && s.links.length) fm.push(`links: ${yamlList(s.links)}`);
  fm.push('catalyst_managed: true');
  const footer =
    s.links && s.links.length
      ? `\n\n---\n*Links:* ${s.links.map((l) => `[[${l}]]`).join(' · ')}\n`
      : '';
  return `---\n${fm.join('\n')}\n---\n${s.body}${footer}`;
}

/** Coerce an untrusted (IPC-supplied) entry into a safe, well-typed shape. */
function sanitizeEntry(entry: BrainEntry): BrainEntry {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  return {
    id: String(entry.id ?? ''),
    title: String(entry.title ?? entry.id ?? 'Untitled'),
    source: String(entry.source ?? 'manual'),
    body: String(entry.body ?? ''),
    type: str(entry.type),
    project: str(entry.project),
    created: str(entry.created),
    updated: str(entry.updated),
    author: str(entry.author),
    status: str(entry.status),
    tags: arr(entry.tags),
    links: arr(entry.links),
  };
}

export class BrainWriter {
  private static _instance: BrainWriter | null = null;
  static instance(): BrainWriter {
    if (!this._instance) this._instance = new BrainWriter();
    return this._instance;
  }

  /** Write one canonical entry into the managed `_catalyst/` subtree. */
  async writeEntry(entry: BrainEntry): Promise<BrainWriteResult> {
    if (!entry || typeof entry !== 'object' || typeof (entry as BrainEntry).id !== 'string' || (entry as BrainEntry).id.length === 0) {
      return { ok: false, relPath: null, hash: null, error: 'invalid-path' };
    }
    const rel = brainEntryRelPath(entry);
    // No expectedHash → idempotent overwrite (the entry id IS the identity).
    return BrainService.instance().writeNote(rel, serializeBrainEntry(entry));
  }
}
