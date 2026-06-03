import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BrainService } from './brain-service';
import type {
  BrainIndexError,
  BrainIndexResult,
  BrainIndexStatus,
  BrainNote,
  BrainSearchHit,
  BrainSearchResult,
} from '../shared/types';

/**
 * BrainIndex — the RAG layer (P3). Chunks the Brain notes, embeds each chunk
 * with an Ollama embedding model, persists the vectors in userData, and answers
 * semantic queries by cosine similarity. Realizes BACKLOG #4 ("embedding-RAG
 * over past sessions") over the unified Brain substrate.
 *
 * Gated on Ollama: a build/query when the daemon is down or the model isn't
 * pulled returns a clear `ollama-unreachable` / `model-missing` error rather
 * than throwing. The index is a plain JSON file in userData (never written into
 * the user's vault), keyed by folder path so switching Brains is clean.
 */

const STORE_FILE = 'brain-index.json';
const OLLAMA_BASE = process.env.CATALYST_OLLAMA_URL || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'nomic-embed-text';
const MAX_CHUNKS = 8000;
const CHUNK_TARGET = 900; // chars
const EMBED_TIMEOUT_MS = 20000;

interface IndexEntry {
  relPath: string;
  title: string;
  chunkIndex: number;
  text: string;
  noteHash: string;
  vector: number[];
}

interface PersistedIndex {
  folder: string;
  model: string;
  dim: number;
  updatedAt: string;
  truncated: boolean;
  entries: IndexEntry[];
}

export class BrainIndex {
  private static _instance: BrainIndex | null = null;
  static instance(): BrainIndex {
    if (!this._instance) this._instance = new BrainIndex();
    return this._instance;
  }

  private storePath(): string {
    return path.join(app.getPath('userData'), STORE_FILE);
  }

  private load(): PersistedIndex | null {
    try {
      const raw = fs.readFileSync(this.storePath(), 'utf8');
      const p = JSON.parse(raw) as PersistedIndex;
      if (!p || !Array.isArray(p.entries)) return null;
      return p;
    } catch {
      return null;
    }
  }

  private save(idx: PersistedIndex): void {
    const target = this.storePath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(idx), { mode: 0o600 });
      fs.renameSync(tmp, target);
    } catch {
      // Non-fatal — index just won't persist this session.
    }
  }

  /** Current index status for the configured Brain folder. */
  status(): BrainIndexStatus {
    const folder = BrainService.instance().getConfig().folder;
    const idx = this.load();
    const matches = !!idx && !!folder && idx.folder === folder;
    return {
      built: matches,
      folder: folder ?? null,
      model: idx?.model ?? DEFAULT_MODEL,
      notes: matches ? new Set(idx!.entries.map((e) => e.relPath)).size : 0,
      chunks: matches ? idx!.entries.length : 0,
      dim: idx?.dim ?? 0,
      updatedAt: matches ? idx!.updatedAt : null,
      truncated: matches ? idx!.truncated : false,
    };
  }

  /**
   * (Re)build the index. Reuses vectors for notes whose content hash is
   * unchanged since the last build (incremental), so re-running after editing
   * one note only re-embeds that note.
   */
  async rebuild(model?: string): Promise<BrainIndexResult> {
    const svc = BrainService.instance();
    const cfg = svc.getConfig();
    if (!cfg.ready || !cfg.folder) return this.fail('no-brain-folder');
    const useModel = (model && model.trim()) || this.load()?.model || DEFAULT_MODEL;

    const reachable = await this.ollamaReachable();
    if (!reachable) return this.fail('ollama-unreachable');

    const list = await svc.listNotes();
    if (list.notes.length === 0) return this.fail('no-notes');

    // Reusable vectors from the prior index, keyed by relPath#noteHash.
    const prior = this.load();
    const reuse = new Map<string, IndexEntry[]>();
    if (prior && prior.folder === cfg.folder && prior.model === useModel) {
      for (const e of prior.entries) {
        const key = `${e.relPath}#${e.noteHash}`;
        const arr = reuse.get(key) ?? [];
        arr.push(e);
        reuse.set(key, arr);
      }
    }

    const entries: IndexEntry[] = [];
    let dim = prior?.dim ?? 0;
    let truncated = false;
    let modelMissing = false;

    outer: for (const summary of list.notes) {
      const note = await svc.readNote(summary.relPath);
      if ('error' in note) continue;
      const key = `${note.relPath}#${note.hash}`;
      const cached = reuse.get(key);
      if (cached) {
        for (const e of cached) {
          if (entries.length >= MAX_CHUNKS) { truncated = true; break outer; }
          entries.push(e);
          if (e.vector.length) dim = e.vector.length;
        }
        continue;
      }
      const chunks = chunkNote(note);
      for (let i = 0; i < chunks.length; i++) {
        if (entries.length >= MAX_CHUNKS) { truncated = true; break outer; }
        let vector: number[] | null;
        try {
          vector = await this.embed(useModel, chunks[i]);
        } catch (e) {
          if (String((e as Error).message).includes('model')) { modelMissing = true; break outer; }
          throw e;
        }
        if (!vector) { modelMissing = true; break outer; }
        dim = vector.length;
        entries.push({
          relPath: note.relPath,
          title: summary.title,
          chunkIndex: i,
          text: chunks[i],
          noteHash: note.hash,
          vector,
        });
      }
    }

    if (modelMissing && entries.length === 0) return this.fail('model-missing');

    const idx: PersistedIndex = {
      folder: cfg.folder,
      model: useModel,
      dim,
      updatedAt: new Date().toISOString(),
      truncated,
      entries,
    };
    this.save(idx);
    return { ok: true, status: this.status(), error: null };
  }

  /** Semantic search: embed the query, cosine-rank chunks, return top-k. */
  async query(text: string, k = 8): Promise<BrainSearchResult> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { ok: true, hits: [], error: null };
    }
    const idx = this.load();
    const folder = BrainService.instance().getConfig().folder;
    if (!idx || !folder || idx.folder !== folder || idx.entries.length === 0) {
      return { ok: false, hits: [], error: 'not-built' };
    }
    if (!(await this.ollamaReachable())) return { ok: false, hits: [], error: 'ollama-unreachable' };

    let qv: number[] | null;
    try {
      qv = await this.embed(idx.model, text);
    } catch {
      return { ok: false, hits: [], error: 'model-missing' };
    }
    if (!qv) return { ok: false, hits: [], error: 'model-missing' };

    const scored: BrainSearchHit[] = idx.entries.map((e) => ({
      relPath: e.relPath,
      title: e.title,
      snippet: e.text.length > 280 ? e.text.slice(0, 280) + '…' : e.text,
      score: cosine(qv!, e.vector),
      chunkIndex: e.chunkIndex,
    }));
    scored.sort((a, b) => b.score - a.score);
    // De-dupe so one note doesn't dominate with many chunks; keep best per note
    // until we have k, then allow extras.
    const seen = new Set<string>();
    const primary: BrainSearchHit[] = [];
    const extra: BrainSearchHit[] = [];
    for (const h of scored) {
      if (!seen.has(h.relPath)) { seen.add(h.relPath); primary.push(h); }
      else extra.push(h);
    }
    return { ok: true, hits: [...primary, ...extra].slice(0, Math.max(1, Math.min(50, k))), error: null };
  }

  // --- ollama ---------------------------------------------------------------

  private async ollamaReachable(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Returns the embedding vector, or throws Error('model …') if the model is
   *  not available. Returns null on a malformed response. */
  private async embed(model: string, text: string): Promise<number[] | null> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // Ollama returns 404 + "model '…' not found" when the model isn't pulled.
        if (res.status === 404 || /not found|no such model|model/i.test(body)) {
          throw new Error('model not found');
        }
        throw new Error(`ollama ${res.status}`);
      }
      const j = (await res.json()) as { embedding?: unknown };
      if (Array.isArray(j.embedding) && j.embedding.every((n) => typeof n === 'number')) {
        return j.embedding as number[];
      }
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  private fail(error: BrainIndexError): BrainIndexResult {
    return { ok: false, status: this.status(), error };
  }
}

// --- pure helpers ----------------------------------------------------------

/** Split a note into ~CHUNK_TARGET-char chunks on paragraph boundaries. The
 *  title + headings are prepended to each chunk for retrieval context. */
export function chunkNote(note: BrainNote): string[] {
  const header = note.frontmatter.title || note.relPath;
  const paras = note.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf.length > 0 && buf.length + p.length + 2 > CHUNK_TARGET) {
      chunks.push(`${header}\n\n${buf}`.trim());
      buf = p;
    } else {
      buf = buf.length ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf.trim().length > 0) chunks.push(`${header}\n\n${buf}`.trim());
  // A note with only frontmatter / empty body still gets one header chunk so it
  // can be found by title.
  if (chunks.length === 0) chunks.push(header);
  return chunks;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
