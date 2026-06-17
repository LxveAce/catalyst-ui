import type { IpcMain, App } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STORE_FILE = 'notes.json';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

interface NoteStore {
  notes: Note[];
}

type NoteCreateInput = {
  title: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
};

type NoteUpdateInput = {
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
};

function generateId(): string {
  const ts = Date.now().toString(16);
  const rand = crypto.randomBytes(2).toString('hex');
  return `note_${ts}${rand}`;
}

class NotesService {
  private storePath: string;
  private store: NoteStore;

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, STORE_FILE);
    this.store = this.read();
  }

  list(): Note[] {
    return this.store.notes.slice();
  }

  create(data: NoteCreateInput): Note {
    const now = Date.now();
    const note: Note = {
      id: generateId(),
      title: (data.title ?? '').trim(),
      content: (data.content ?? '').trim(),
      tags: Array.isArray(data.tags) ? data.tags.map(t => String(t).trim()).filter(Boolean) : [],
      pinned: data.pinned === true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.notes.push(note);
    this.write();
    return note;
  }

  update(id: string, data: NoteUpdateInput): Note {
    const idx = this.findIndex(id);
    const current = this.store.notes[idx];
    const next: Note = { ...current };
    if (data.title !== undefined) next.title = data.title.trim();
    if (data.content !== undefined) next.content = data.content;
    if (data.tags !== undefined) {
      next.tags = Array.isArray(data.tags)
        ? data.tags.map(t => String(t).trim()).filter(Boolean)
        : [];
    }
    if (data.pinned !== undefined) next.pinned = data.pinned === true;
    next.updatedAt = Date.now();
    this.store.notes[idx] = next;
    this.write();
    return next;
  }

  delete(id: string): boolean {
    const idx = this.findIndexOrNull(id);
    if (idx === null) return false;
    this.store.notes.splice(idx, 1);
    this.write();
    return true;
  }

  private findIndex(id: string): number {
    const idx = this.findIndexOrNull(id);
    if (idx === null) throw new Error(`Note not found: ${id}`);
    return idx;
  }

  private findIndexOrNull(id: string): number | null {
    if (typeof id !== 'string') return null;
    const i = this.store.notes.findIndex(n => n.id === id);
    return i === -1 ? null : i;
  }

  private read(): NoteStore {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { notes: [] };
      throw new Error(
        `Refusing to use ${this.storePath}: ${(e as Error).message}. Fix or delete the file.`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Refusing to use ${this.storePath}: not valid JSON (${(e as Error).message}).`
      );
    }
    if (!parsed || typeof parsed !== 'object') return { notes: [] };
    const arr = (parsed as { notes?: unknown }).notes;
    if (!Array.isArray(arr)) return { notes: [] };
    const valid: Note[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const s = item as Record<string, unknown>;
      if (typeof s.id !== 'string' || s.id.length === 0) continue;
      if (typeof s.title !== 'string') continue;
      if (typeof s.content !== 'string') continue;
      const tags = Array.isArray(s.tags)
        ? (s.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];
      const pinned = s.pinned === true;
      const createdAt = typeof s.createdAt === 'number' ? s.createdAt : 0;
      const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : createdAt;
      valid.push({ id: s.id, title: s.title, content: s.content, tags, pinned, createdAt, updatedAt });
    }
    return { notes: valid };
  }

  private write(): void {
    const payload = JSON.stringify(this.store, null, 2);
    if (Buffer.byteLength(payload, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`Notes store would exceed the ${MAX_FILE_BYTES / 1024 / 1024} MB size limit`);
    }
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, payload, { mode: 0o600 });
      fs.renameSync(tmp, this.storePath);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      throw e;
    }
  }
}

export function setupNotesIPC(ipcMain: IpcMain, electronApp: App): void {
  const service = new NotesService(electronApp.getPath('userData'));

  ipcMain.handle('notes:list', async () => {
    return service.list();
  });

  ipcMain.handle('notes:create', async (_event, data: NoteCreateInput) => {
    return service.create(data);
  });

  ipcMain.handle('notes:update', async (_event, id: string, data: NoteUpdateInput) => {
    return service.update(id, data);
  });

  ipcMain.handle('notes:delete', async (_event, id: string) => {
    return service.delete(id);
  });
}
