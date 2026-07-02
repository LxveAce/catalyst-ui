import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BrainBaseDoc,
  BrainCanvas,
  BrainCanvasNode,
  BrainConfig,
  BrainDiffLine,
  BrainListResult,
  BrainNote,
  BrainNoteSummary,
  BrainSpecialList,
  BrainWritePreview,
  BrainWriteResult,
  Wikilink,
} from '../shared/types';

/**
 * BrainService — Catalyst Brain Folder Service (Obsidian integration, P1).
 *
 * Scoped, safe read/write of an Obsidian-COMPATIBLE folder of `.md` notes
 * (YAML frontmatter + `[[wikilinks]]`). No Obsidian binary involved — Catalyst
 * owns the files directly against the public formats. This is the substrate the
 * rest of the Brain (P2 unification writer, P3 RAG, P4 interop) builds on.
 *
 * Hard guarantees (red-team surface):
 *   - **Path scoping.** Every note path is resolved under the configured Brain
 *     root; anything that escapes (../, absolute, symlink-out) is rejected.
 *     Mirrors the ProjectExplorer path-traversal guard.
 *   - **Diff before write.** `previewWrite` / `previewDelete` produce a diff the
 *     UI shows before any destructive change is committed.
 *   - **Optimistic concurrency.** `readNote` returns a content hash; `writeNote`
 *     can require it (`expectedHash`) and refuses with `conflict` if the file
 *     changed underneath us (external editor / Obsidian Sync).
 *   - **Atomic writes.** tmp + rename, never a partial file (matches cli-flags /
 *     session-service).
 *   - **Frontmatter preserved.** The raw `---` block round-trips verbatim; we
 *     never lose unknown YAML fields on a body edit.
 *
 * "Brain" is deliberately distinct from "vault" (the existing compact-controller
 * JSON sync). Don't conflate them.
 */

const CONFIG_FILE = 'brain-config.json';
const MAX_NOTES = 5000;
const MAX_NOTE_BYTES = 5 * 1024 * 1024; // 5 MB read cap per note
const MAX_WALK_DEPTH = 12;
const MAX_REL_LEN = 1024;
/** Directories never walked / written into inside a Brain folder. */
const IGNORE_DIRS = new Set(['.git', '.obsidian', 'node_modules', '.trash', '.catalyst']);

export class BrainService {
  private static _instance: BrainService | null = null;
  static instance(): BrainService {
    if (!this._instance) this._instance = new BrainService();
    return this._instance;
  }

  private configPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE);
  }

  // --- config ---------------------------------------------------------------

  getConfig(): BrainConfig {
    let folder: string | null = null;
    try {
      const raw = fs.readFileSync(this.configPath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<BrainConfig>;
      if (typeof parsed.folder === 'string' && parsed.folder.length > 0) {
        folder = parsed.folder;
      }
    } catch {
      // Missing/corrupt config → no Brain folder yet.
    }
    return { folder, ready: this.isDir(folder) };
  }

  /** Set (or clear, with null) the Brain folder. Validates it's a directory. */
  setFolder(folder: string | null): BrainConfig {
    if (folder !== null) {
      if (typeof folder !== 'string' || folder.length === 0 || folder.length > MAX_REL_LEN) {
        return this.getConfig();
      }
      const resolved = path.resolve(folder);
      if (!this.isDir(resolved)) {
        // Refuse to point the Brain at a non-directory; keep prior config.
        return this.getConfig();
      }
      this.writeConfig({ folder: resolved });
      return { folder: resolved, ready: true };
    }
    this.writeConfig({ folder: null });
    return { folder: null, ready: false };
  }

  private writeConfig(cfg: BrainConfig | { folder: string | null }): void {
    const target = this.configPath();
    const payload = JSON.stringify({ folder: cfg.folder ?? null }, null, 2);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(tmp, payload, { mode: 0o600 });
        fs.renameSync(tmp, target);
      } catch (e) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      }
    } catch {
      // Non-fatal — applies for this session, just won't persist.
    }
  }

  /** Current Brain root if configured AND on disk, else null. */
  private root(): string | null {
    const { folder } = this.getConfig();
    return this.isDir(folder) ? path.resolve(folder!) : null;
  }

  /**
   * Guarded absolute on-disk path for a Brain-relative note (or the root when
   * `rel` is empty). null when there's no Brain folder or the path escapes
   * root. Used by the obsidian:// interop to build a safe URI from a path the
   * renderer can only address inside the Brain.
   */
  absPathFor(rel?: string): string | null {
    const root = this.root();
    if (!root) return null;
    if (!rel || rel.trim().length === 0 || rel === '.') return root;
    return this.resolveNotePath(root, rel, { requireMd: false });
  }

  private isDir(p: string | null | undefined): boolean {
    if (!p) return false;
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Resolve a Brain-relative path to an absolute path INSIDE the root.
   * Returns null on any escape (absolute input, `..` traversal, prefix trick).
   * Also enforces the `.md` extension and the IGNORE_DIRS blocklist.
   */
  private resolveNotePath(root: string, rel: string, opts?: { requireMd?: boolean }): string | null {
    if (typeof rel !== 'string' || rel.length === 0 || rel.length > MAX_REL_LEN) return null;
    // Reject absolute inputs and Windows drive-letter paths outright.
    if (path.isAbsolute(rel)) return null;
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, rel);
    // Path-traversal guard (the +sep prevents `/foo/bar` passing for root `/foo/ba`).
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      return null;
    }
    // Symlink-escape guard: the string checks above don't follow symlinks, so a note (or an
    // intermediate dir) that is a symlink pointing outside the vault would still pass. Resolve the
    // REAL path of the deepest existing ancestor (the target may be a not-yet-created file) and
    // confirm it stays inside the real root.
    try {
      const realRoot = fs.realpathSync(resolvedRoot);
      let probe = resolved;
      while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
      const realProbe = fs.realpathSync(probe);
      if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
        return null;
      }
    } catch {
      return null;
    }
    // Block ignored dirs anywhere in the relative path.
    const relParts = path.relative(resolvedRoot, resolved).split(path.sep);
    if (relParts.some((seg) => IGNORE_DIRS.has(seg))) return null;
    if ((opts?.requireMd ?? true) && path.extname(resolved).toLowerCase() !== '.md') return null;
    return resolved;
  }

  /** POSIX-style relative path (stable note id across platforms). */
  private toRel(root: string, abs: string): string {
    return path.relative(root, abs).split(path.sep).join('/');
  }

  // --- listing --------------------------------------------------------------

  async listNotes(): Promise<BrainListResult> {
    const root = this.root();
    if (!root) return { root: null, notes: [], truncated: false, error: 'no-brain-folder' };

    const notes: BrainNoteSummary[] = [];
    let truncated = false;

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (truncated || depth > MAX_WALK_DEPTH) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return; // unreadable dir — skip, don't fail the whole listing
      }
      // Dirs first for stable-ish traversal; files collected as found.
      for (const e of entries) {
        if (truncated) return;
        if (e.name.startsWith('.') && IGNORE_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (IGNORE_DIRS.has(e.name)) continue;
          await walk(full, depth + 1);
        } else if (e.isFile() && path.extname(e.name).toLowerCase() === '.md') {
          if (notes.length >= MAX_NOTES) {
            truncated = true;
            return;
          }
          let st: fs.Stats;
          try {
            st = await fsp.stat(full);
          } catch {
            continue;
          }
          notes.push({
            relPath: this.toRel(root, full),
            title: path.basename(e.name, '.md'),
            size: st.size,
            modified: st.mtime.toISOString(),
          });
        }
      }
    };

    try {
      await walk(root, 0);
    } catch {
      return { root, notes, truncated, error: 'access-denied' };
    }
    notes.sort((a, b) => a.relPath.localeCompare(b.relPath, undefined, { sensitivity: 'base' }));
    return { root, notes, truncated, error: null };
  }

  /** List the non-`.md` Obsidian docs (Canvas `.canvas`, Bases `.base`). */
  async listSpecial(): Promise<BrainSpecialList> {
    const root = this.root();
    const canvases: BrainNoteSummary[] = [];
    const bases: BrainNoteSummary[] = [];
    if (!root) return { canvases, bases };

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_WALK_DEPTH) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (IGNORE_DIRS.has(e.name)) continue;
          await walk(full, depth + 1);
        } else if (e.isFile()) {
          const ext = path.extname(e.name).toLowerCase();
          if (ext !== '.canvas' && ext !== '.base') continue;
          const bucket = ext === '.canvas' ? canvases : bases;
          if (bucket.length >= MAX_NOTES) continue;
          let st: fs.Stats;
          try {
            st = await fsp.stat(full);
          } catch {
            continue;
          }
          bucket.push({
            relPath: this.toRel(root, full),
            title: path.basename(e.name, ext),
            size: st.size,
            modified: st.mtime.toISOString(),
          });
        }
      }
    };
    try {
      await walk(root, 0);
    } catch {
      // best-effort
    }
    const byPath = (a: BrainNoteSummary, b: BrainNoteSummary) =>
      a.relPath.localeCompare(b.relPath, undefined, { sensitivity: 'base' });
    canvases.sort(byPath);
    bases.sort(byPath);
    return { canvases, bases };
  }

  /** Read + parse a JSON Canvas (`.canvas`) file into a node/edge summary. */
  async readCanvas(rel: string): Promise<BrainCanvas | { error: string }> {
    const doc = await this.readSpecial(rel, '.canvas');
    if ('error' in doc) return doc;
    let parsed: { nodes?: unknown; edges?: unknown };
    try {
      parsed = JSON.parse(doc.raw);
    } catch {
      return { error: 'invalid-json' };
    }
    const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const nodes: BrainCanvasNode[] = rawNodes.slice(0, 2000).map((n): BrainCanvasNode => {
      const o = (n ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      return {
        id: String(o.id ?? ''),
        type: typeof o.type === 'string' ? o.type : 'unknown',
        text: str(o.text),
        file: str(o.file),
        url: str(o.url),
        label: str(o.label),
      };
    });
    const edgeCount = Array.isArray(parsed.edges) ? parsed.edges.length : 0;
    return { relPath: doc.relPath, nodes, edgeCount };
  }

  /** Read a Bases (`.base`) file: raw text + a LIGHT top-level YAML parse
   *  (no dependency; complex views stay in `raw`). */
  async readBase(rel: string): Promise<BrainBaseDoc | { error: string }> {
    const doc = await this.readSpecial(rel, '.base');
    if ('error' in doc) return doc;
    return {
      relPath: doc.relPath,
      parsed: lightParseFrontmatter(doc.raw) as Record<string, unknown>,
      raw: doc.raw,
    };
  }

  /** Shared guarded read for a non-`.md` doc of a specific extension. */
  private async readSpecial(
    rel: string,
    ext: '.canvas' | '.base'
  ): Promise<{ relPath: string; raw: string } | { error: string }> {
    const root = this.root();
    if (!root) return { error: 'no-brain-folder' };
    const abs = this.resolveNotePath(root, rel, { requireMd: false });
    if (!abs || path.extname(abs).toLowerCase() !== ext) return { error: 'outside-root' };
    let st: fs.Stats;
    try {
      st = await fsp.stat(abs);
    } catch {
      return { error: 'not-found' };
    }
    if (!st.isFile()) return { error: 'not-found' };
    if (st.size > MAX_NOTE_BYTES) return { error: 'too-large' };
    return { relPath: this.toRel(root, abs), raw: await fsp.readFile(abs, 'utf8') };
  }

  // --- read -----------------------------------------------------------------

  async readNote(rel: string): Promise<BrainNote | { error: NonNullable<BrainWritePreview['error']> | 'not-found' | 'too-large' }> {
    const root = this.root();
    if (!root) return { error: 'no-brain-folder' };
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return { error: 'outside-root' };

    let st: fs.Stats;
    try {
      st = await fsp.stat(abs);
    } catch {
      return { error: 'not-found' };
    }
    if (!st.isFile()) return { error: 'not-found' };
    if (st.size > MAX_NOTE_BYTES) return { error: 'too-large' };

    const raw = await fsp.readFile(abs, 'utf8');
    const { frontmatterRaw, frontmatter, body } = splitFrontmatter(raw);
    return {
      relPath: this.toRel(root, abs),
      hash: sha256(raw),
      frontmatterRaw,
      frontmatter,
      body,
      headings: extractHeadings(body),
      links: extractWikilinks(body),
      size: st.size,
      modified: st.mtime.toISOString(),
    };
  }

  // --- preview (diff-before-write) -----------------------------------------

  /** Preview an overwrite/create of `rel` with `newContent`. */
  async previewWrite(rel: string, newContent: string): Promise<BrainWritePreview> {
    const root = this.root();
    if (!root) {
      return this.emptyPreview(rel, 'no-brain-folder', newContent);
    }
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return this.emptyPreview(rel, 'outside-root', newContent);
    if (typeof newContent !== 'string') return this.emptyPreview(rel, 'invalid-path', null);

    let oldContent: string | null = null;
    let exists = false;
    try {
      oldContent = await fsp.readFile(abs, 'utf8');
      exists = true;
    } catch {
      exists = false;
    }
    const identical = exists && oldContent === newContent;
    return {
      relPath: this.toRel(root, abs),
      exists,
      oldContent,
      newContent,
      identical,
      diff: lineDiff(oldContent ?? '', newContent),
      error: null,
    };
  }

  /** Preview a delete of `rel` (newContent null, full old content shown). */
  async previewDelete(rel: string): Promise<BrainWritePreview> {
    const root = this.root();
    if (!root) return this.emptyPreview(rel, 'no-brain-folder', null);
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return this.emptyPreview(rel, 'outside-root', null);
    let oldContent: string | null = null;
    let exists = false;
    try {
      oldContent = await fsp.readFile(abs, 'utf8');
      exists = true;
    } catch {
      exists = false;
    }
    return {
      relPath: this.toRel(root, abs),
      exists,
      oldContent,
      newContent: null,
      identical: false,
      diff: lineDiff(oldContent ?? '', ''),
      error: null,
    };
  }

  private emptyPreview(
    rel: string,
    error: NonNullable<BrainWritePreview['error']>,
    newContent: string | null
  ): BrainWritePreview {
    return {
      relPath: typeof rel === 'string' ? rel : '',
      exists: false,
      oldContent: null,
      newContent,
      identical: false,
      diff: [],
      error,
    };
  }

  // --- write / create / append / delete ------------------------------------

  /**
   * Overwrite (or create) a note. When `expectedHash` is provided and the file
   * exists, the current on-disk content must hash to it, else we refuse with
   * `conflict` (someone edited it underneath us). Atomic.
   */
  async writeNote(rel: string, content: string, expectedHash?: string): Promise<BrainWriteResult> {
    const root = this.root();
    if (!root) return this.fail('no-brain-folder');
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return this.fail('outside-root');
    if (typeof content !== 'string') return this.fail('invalid-path');

    let exists = false;
    try {
      const cur = await fsp.readFile(abs, 'utf8');
      exists = true;
      if (typeof expectedHash === 'string' && expectedHash.length > 0 && sha256(cur) !== expectedHash) {
        return this.fail('conflict');
      }
    } catch {
      exists = false;
    }
    return this.atomicWrite(root, abs, content, exists);
  }

  /** Create a new note; refuses if it already exists. */
  async createNote(rel: string, content: string): Promise<BrainWriteResult> {
    const root = this.root();
    if (!root) return this.fail('no-brain-folder');
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return this.fail('outside-root');
    if (typeof content !== 'string') return this.fail('invalid-path');
    try {
      await fsp.access(abs);
      return this.fail('already-exists');
    } catch {
      // good — doesn't exist
    }
    return this.atomicWrite(root, abs, content, false);
  }

  /** Append text to an existing note's body (creates it if missing). */
  async appendNote(rel: string, text: string): Promise<BrainWriteResult> {
    const root = this.root();
    if (!root) return this.fail('no-brain-folder');
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return this.fail('outside-root');
    if (typeof text !== 'string') return this.fail('invalid-path');
    let cur = '';
    try {
      cur = await fsp.readFile(abs, 'utf8');
    } catch {
      cur = '';
    }
    const joined = cur.length === 0 ? text : `${cur.replace(/\n*$/, '')}\n\n${text}`;
    return this.atomicWrite(root, abs, joined, cur.length > 0);
  }

  /** Delete a note. Caller should previewDelete + confirm in the UI first. */
  async deleteNote(rel: string): Promise<BrainWriteResult> {
    const root = this.root();
    if (!root) return this.fail('no-brain-folder');
    const abs = this.resolveNotePath(root, rel);
    if (!abs) return this.fail('outside-root');
    try {
      await fsp.unlink(abs);
      return { ok: true, relPath: this.toRel(root, abs), hash: null, error: null };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return this.fail('not-found');
      return this.fail('write-failed');
    }
  }

  private async atomicWrite(
    root: string,
    abs: string,
    content: string,
    _exists: boolean
  ): Promise<BrainWriteResult> {
    try {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      try {
        await fsp.writeFile(tmp, content, 'utf8');
        await fsp.rename(tmp, abs);
      } catch (e) {
        try { await fsp.unlink(tmp); } catch { /* ignore */ }
        throw e;
      }
      return { ok: true, relPath: this.toRel(root, abs), hash: sha256(content), error: null };
    } catch {
      return this.fail('write-failed');
    }
  }

  private fail(error: NonNullable<BrainWriteResult['error']>): BrainWriteResult {
    return { ok: false, relPath: null, hash: null, error };
  }
}

// ===========================================================================
// Pure helpers (exported for unit-testing; no Electron / fs dependencies).
// ===========================================================================

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Split an Obsidian note into its frontmatter block + body. The raw frontmatter
 * (without fences) is preserved verbatim for lossless round-tripping; a LIGHT
 * parse extracts common scalar/list fields for display — this is intentionally
 * NOT a full YAML parser (no dependency), so complex structures live only in
 * `frontmatterRaw`.
 */
export function splitFrontmatter(raw: string): {
  frontmatterRaw: string | null;
  frontmatter: BrainNote['frontmatter'];
  body: string;
} {
  // Frontmatter must be the very first thing: `---\n ... \n---`.
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { frontmatterRaw: null, frontmatter: {}, body: raw };
  const frontmatterRaw = m[1];
  const body = raw.slice(m[0].length);
  return { frontmatterRaw, frontmatter: lightParseFrontmatter(frontmatterRaw), body };
}

/** Minimal `key: value` / inline-`[a, b]` / `- item` list parse. */
function lightParseFrontmatter(text: string): BrainNote['frontmatter'] {
  const out: BrainNote['frontmatter'] = {};
  const lines = text.split(/\r?\n/);
  let lastListKey: string | null = null;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    // `  - item` continuation of a block list.
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && lastListKey) {
      const arr = (out[lastListKey] as string[] | undefined) ?? [];
      arr.push(stripQuotes(listItem[1].trim()));
      out[lastListKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim();
    if (val.length === 0) {
      // Likely a block list/map follows.
      lastListKey = key;
      out[key] = [];
      continue;
    }
    lastListKey = null;
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
    } else {
      out[key] = stripQuotes(val);
    }
  }
  // Normalize the two fields the UI cares about into string[] shape.
  for (const k of ['tags', 'aliases'] as const) {
    const v = out[k] as unknown;
    if (typeof v === 'string') out[k] = [v];
  }
  return out;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Extract markdown ATX headings (ignores `#` inside fenced code blocks). */
export function extractHeadings(body: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2] });
  }
  return out;
}

/** Extract `[[wikilinks]]` with optional `#heading` and `|alias`. */
export function extractWikilinks(body: string): Wikilink[] {
  const out: Wikilink[] = [];
  const re = /\[\[([^\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1];
    let target = inner;
    let alias: string | undefined;
    let heading: string | undefined;
    const pipe = target.indexOf('|');
    if (pipe >= 0) {
      alias = target.slice(pipe + 1).trim();
      target = target.slice(0, pipe);
    }
    const hash = target.indexOf('#');
    if (hash >= 0) {
      heading = target.slice(hash + 1).trim();
      target = target.slice(0, hash);
    }
    out.push({ raw: m[0], target: target.trim(), heading, alias });
  }
  return out;
}

/**
 * Cheap, deterministic line diff: shared common prefix + suffix, with the
 * changed middle shown as deletions then additions. Not a minimal-edit (Myers)
 * diff, but accurate and dependency-free — enough for a "here's what will
 * change" write preview.
 */
export function lineDiff(oldText: string, newText: string): BrainDiffLine[] {
  if (oldText === newText) {
    return oldText.length === 0
      ? []
      : oldText.split('\n').map((text) => ({ type: 'same' as const, text }));
  }
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  const out: BrainDiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ type: 'same', text: a[i] });
  for (let i = start; i <= endA; i++) out.push({ type: 'del', text: a[i] });
  for (let i = start; i <= endB; i++) out.push({ type: 'add', text: b[i] });
  for (let i = endA + 1; i < a.length; i++) out.push({ type: 'same', text: a[i] });
  return out;
}
