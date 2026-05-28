import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BrowserWindow } from 'electron';
import { net } from 'electron';
import type {
  HFAuditEntry,
  HFDownloadProgress,
  HFDownloadResult,
  HFGgufMetadata,
  HFGgufVariant,
  HFModelCard,
  HFSearchHit,
  HFSearchOptions,
  HFSettings,
  HFCachedEntry,
} from '../shared/types';

const SETTINGS_FILE = 'huggingface-settings.json';
const CACHE_DIR_NAME = 'hf-cache';
const AUDIT_LOG_FILE = 'huggingface-research-audit.jsonl';
const MAX_AUDIT_ENTRIES = 1000;

const DEFAULT_SETTINGS: HFSettings = {
  researchModeEnabled: false,
  researchModeAcknowledgedAt: null,
  cachePath: null,
};

const MAX_RESULTS = 50;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * HuggingFaceService — main-process facade over @huggingface/hub.
 *
 * Provides search / model card / GGUF discovery / Ollama-bridge import /
 * local cache management.  The renderer talks to this strictly via IPC;
 * raw API tokens (none, for now) never cross the boundary.
 *
 * Caching strategy:
 *   - We default to <userData>/hf-cache to keep ownership inside the app
 *     directory (auto-cleaned by `Reset User Data`).
 *   - If the user has an existing `~/.cache/huggingface` populated, we
 *     prefer it so a fresh install reuses their existing downloads.
 *   - The first explicit setSettings({cachePath}) overrides both.
 *
 * Research mode (uncensored / experimental catalogs):
 *   - Disabled by default.  Settings -> Advanced -> "Enable Research
 *     Catalogs" toggle with explicit disclaimer in the renderer.
 *   - When enabled, the renderer exposes a Research sub-tab that lists
 *     curated HF Collections.  Per-model Ollama imports for research
 *     content run under an isolated OLLAMA_MODELS env override
 *     (sandbox path) and append a line to the audit log on every run.
 *   - Acknowledgement timestamp persists so the disclaimer doesn't
 *     re-prompt on every launch once accepted.
 */
export class HuggingFaceService {
  private settingsPath: string;
  private settings: HFSettings;
  private hfModule: typeof import('@huggingface/hub') | null = null;
  private hfModuleError: string | null = null;

  constructor() {
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.settings = this.readSettings();
    this.ensureCacheDir();
  }

  // ---- settings ----

  getSettings(): HFSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<HFSettings>): HFSettings {
    const next: HFSettings = { ...this.settings };
    if (partial.researchModeEnabled !== undefined) {
      if (typeof partial.researchModeEnabled !== 'boolean') {
        throw new Error('researchModeEnabled must be a boolean');
      }
      next.researchModeEnabled = partial.researchModeEnabled;
      // Stamp acknowledgement the first time the user flips it on.
      if (partial.researchModeEnabled && !this.settings.researchModeAcknowledgedAt) {
        next.researchModeAcknowledgedAt = new Date().toISOString();
      }
    }
    if (partial.cachePath !== undefined) {
      if (partial.cachePath !== null) {
        if (typeof partial.cachePath !== 'string') {
          throw new Error('cachePath must be a string or null');
        }
        if (!path.isAbsolute(partial.cachePath)) {
          throw new Error('cachePath must be an absolute path');
        }
        if (partial.cachePath.length > 4096) {
          throw new Error('cachePath is too long');
        }
      }
      next.cachePath = partial.cachePath;
    }
    this.settings = next;
    this.writeSettings(next);
    this.ensureCacheDir();
    return { ...this.settings };
  }

  // ---- public surface ----

  /** In-flight downloads, keyed by `${repoId}::${fileName}`, so
   *  cancelDownload() can find the right request to abort. */
  private inFlightDownloads = new Map<string, { abort: () => void }>();

  /** Cancel an in-flight download.  Returns true if a matching transfer
   *  was found and aborted. */
  cancelDownload(repoId: string, fileName: string): boolean {
    const key = `${repoId}::${fileName}`;
    const entry = this.inFlightDownloads.get(key);
    if (!entry) return false;
    entry.abort();
    return true;
  }

  /** Direct GGUF file download to <userData>/hf-cache/<repo>/<file>.
   *  Streams via Electron's net module + emits progress events to all
   *  open windows.  Caller passes a stable transferId so the renderer
   *  can correlate progress events to a specific download.
   *
   *  Stores at `<resolvedCache>/models--<org>--<name>/blobs/<file>` to
   *  mimic Hugging Face's hub layout — that way our Cached tab listing
   *  recognises the result and the user can swap to the upstream HF
   *  cache without re-downloading.
   *
   *  v4.0.2 round 8: skip-if-cached (returns early if the file already
   *  exists), cancellation support (via cancelDownload), and
   *  bytesPerSec / etaSeconds in the progress event using a 5-sample
   *  rolling throughput window.
   */
  async downloadFile(opts: {
    repoId: string;
    fileName: string;
    transferId?: string;
    windowSink?: BrowserWindow[];
  }): Promise<HFDownloadResult> {
    if (!isRepoId(opts.repoId)) throw new Error('invalid repoId');
    if (!isSafeFileName(opts.fileName)) throw new Error('invalid fileName');
    const broadcast = (event: HFDownloadProgress) => {
      try {
        const windows = opts.windowSink ?? [];
        for (const w of windows) {
          if (!w.isDestroyed()) w.webContents.send('hf:download-progress', event);
        }
      } catch {
        // best-effort
      }
    };
    const root = this.getCachePath();
    const repoDir = path.join(root, `models--${opts.repoId.replace('/', '--')}`, 'blobs');
    // Path-traversal guard.
    const repoReal = path.resolve(repoDir);
    const rootReal = path.resolve(root);
    if (!repoReal.startsWith(rootReal + path.sep) && repoReal !== rootReal) {
      throw new Error('cache target escapes the cache root');
    }
    fs.mkdirSync(repoDir, { recursive: true });
    const destPath = path.join(repoDir, opts.fileName);
    // Skip-if-cached: if a complete file already exists, broadcast a
    // synthetic done event and return immediately without any network.
    try {
      const st = fs.statSync(destPath);
      if (st.isFile() && st.size > 0) {
        broadcast({
          repoId: opts.repoId,
          fileName: opts.fileName,
          bytesCompleted: st.size,
          bytesTotal: st.size,
          percent: 100,
          bytesPerSec: null,
          etaSeconds: 0,
          done: true,
          error: null,
        });
        return { ok: true, destPath, bytesWritten: st.size, error: null };
      }
    } catch {
      // missing — fall through to download path
    }
    const tmpPath = `${destPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.part`;
    const url = `https://huggingface.co/${opts.repoId}/resolve/main/${encodeURIComponent(opts.fileName)}`;
    let bytesCompleted = 0;
    let bytesTotal: number | null = null;
    let writeStream: fs.WriteStream | null = null;
    // 5-sample rolling window for throughput estimation.
    const throughputSamples: Array<{ at: number; bytes: number }> = [];
    const transferKey = `${opts.repoId}::${opts.fileName}`;
    let cancelled = false;
    try {
      const request = net.request({ method: 'GET', url, redirect: 'follow' });
      request.setHeader('User-Agent', 'Catalyst-UI/4.x (+https://github.com/LxveAce/catalyst-ui)');
      writeStream = fs.createWriteStream(tmpPath);
      // Register the abort handle so cancelDownload() can find us.
      this.inFlightDownloads.set(transferKey, {
        abort: () => {
          cancelled = true;
          try {
            request.abort();
          } catch {
            // ignore
          }
        },
      });
      await new Promise<void>((resolve, reject) => {
        let lastBroadcastAt = 0;
        request.on('response', (response) => {
          if (response.statusCode >= 400) {
            reject(new Error(`HTTP ${response.statusCode} fetching ${url}`));
            return;
          }
          const lenHeader = response.headers['content-length'];
          if (typeof lenHeader === 'string') {
            const n = Number(lenHeader);
            if (Number.isFinite(n) && n > 0) bytesTotal = n;
          } else if (Array.isArray(lenHeader) && lenHeader[0]) {
            const n = Number(lenHeader[0]);
            if (Number.isFinite(n) && n > 0) bytesTotal = n;
          }
          response.on('data', (chunk: Buffer) => {
            bytesCompleted += chunk.length;
            if (writeStream) writeStream.write(chunk);
            // Throttle progress events to ~10/s.
            const now = Date.now();
            if (now - lastBroadcastAt >= 100) {
              lastBroadcastAt = now;
              // Rolling throughput window: keep last 5 samples ~500ms apart.
              throughputSamples.push({ at: now, bytes: bytesCompleted });
              if (throughputSamples.length > 5) throughputSamples.shift();
              let bytesPerSec: number | null = null;
              let etaSeconds: number | null = null;
              if (throughputSamples.length >= 2) {
                const oldest = throughputSamples[0];
                const newest = throughputSamples[throughputSamples.length - 1];
                const dtSec = (newest.at - oldest.at) / 1000;
                const dB = newest.bytes - oldest.bytes;
                if (dtSec > 0 && dB > 0) {
                  bytesPerSec = dB / dtSec;
                  if (bytesTotal && bytesPerSec > 0) {
                    etaSeconds = Math.max(
                      0,
                      Math.round((bytesTotal - bytesCompleted) / bytesPerSec)
                    );
                  }
                }
              }
              broadcast({
                repoId: opts.repoId,
                fileName: opts.fileName,
                bytesCompleted,
                bytesTotal,
                percent:
                  bytesTotal && bytesTotal > 0
                    ? Math.max(0, Math.min(100, Math.round((bytesCompleted / bytesTotal) * 100)))
                    : null,
                bytesPerSec,
                etaSeconds,
                done: false,
                error: null,
              });
            }
          });
          response.on('end', () => {
            if (writeStream) {
              writeStream.end(() => resolve());
            } else {
              resolve();
            }
          });
          response.on('error', (err: Error) => reject(err));
        });
        request.on('error', (err: Error) => {
          if (cancelled) reject(new Error('cancelled'));
          else reject(err);
        });
        request.on('abort', () => reject(new Error('cancelled')));
        request.end();
      });
      // Atomic rename.
      fs.renameSync(tmpPath, destPath);
      this.inFlightDownloads.delete(transferKey);
      broadcast({
        repoId: opts.repoId,
        fileName: opts.fileName,
        bytesCompleted,
        bytesTotal,
        percent: 100,
        bytesPerSec: null,
        etaSeconds: 0,
        done: true,
        error: null,
      });
      return { ok: true, destPath, bytesWritten: bytesCompleted, error: null };
    } catch (e) {
      this.inFlightDownloads.delete(transferKey);
      try {
        if (writeStream) writeStream.close();
      } catch {
        /* ignore */
      }
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      const msg = e instanceof Error ? e.message : String(e);
      broadcast({
        repoId: opts.repoId,
        fileName: opts.fileName,
        bytesCompleted,
        bytesTotal,
        percent: null,
        bytesPerSec: null,
        etaSeconds: null,
        done: false,
        error: msg,
      });
      return { ok: false, destPath: null, bytesWritten: bytesCompleted, error: msg };
    }
  }

  /** List models matching the query.  Falls back to a reasonable
   *  default-sorted list if no query is provided. */
  async search(opts: HFSearchOptions): Promise<HFSearchHit[]> {
    const mod = await this.loadHubModule();
    const search = String(opts.query ?? '').slice(0, 256);
    const limit = clampInt(opts.limit ?? 30, 1, MAX_RESULTS);
    const task =
      typeof opts.task === 'string' && opts.task.length > 0 && opts.task.length <= 64
        ? opts.task
        : undefined;
    const library =
      typeof opts.library === 'string' && opts.library.length > 0 && opts.library.length <= 64
        ? opts.library
        : undefined;
    const ggufOnly = !!opts.ggufOnly;

    const results: HFSearchHit[] = [];
    let scanned = 0;
    const maxScan = ggufOnly ? Math.max(limit * 4, 80) : limit;
    // Concatenate optional task / library into the search string —
    // listModels' shape across @huggingface/hub versions is more lenient
    // about extra search keywords than per-axis filters, so this gives
    // us deterministic behavior on minor SDK bumps.
    const searchParts: string[] = [];
    if (search) searchParts.push(search);
    if (task) searchParts.push(task);
    if (library) searchParts.push(library);
    const searchString = searchParts.join(' ') || undefined;
    // Sort mapping for the Hub API (the SDK forwards `sort` as a
    // top-level query param).  Default to `downloads` desc when
    // unspecified to match user expectations.
    const sortMap: Record<NonNullable<HFSearchOptions['sort']>, string> = {
      downloads: 'downloads',
      likes: 'likes',
      modified: 'lastModified',
      created: 'createdAt',
      trending: 'trendingScore',
    };
    const sortKey = opts.sort ? sortMap[opts.sort] : 'downloads';

    try {
      // v4.0.2 deep-debug: measured behaviour informs the field set.
      // The Hub's default expand list (returned without any
      // additionalFields) is fixed at: pipeline_tag, private, gated,
      // downloads, lastModified, likes.  Adding any of those triggers
      // "expand[N] contains a duplicate value".  `license` and
      // `description` are NOT valid expand values at all per the API's
      // own error message.  Useful values NOT in the defaults:
      //   tags (array), library_name (string), gguf (object — present
      //   only on GGUF repos!), cardData, downloadsAllTime, siblings,
      //   config, sha, baseModels, author, trendingScore, widgetData.
      // We request the three we actually render: tags, library_name,
      // gguf.  Detecting GGUF via `gguf !== undefined` is the
      // authoritative signal — no more tag-string guessing.
      for await (const raw of mod.listModels({
        search: searchString ? { query: searchString } : undefined,
        limit: maxScan,
        additionalFields: ['tags', 'library_name', 'gguf'],
        sort: sortKey,
      } as Parameters<typeof mod.listModels>[0])) {
        const model = raw as ModelEntryLoose;
        scanned++;
        const tags: string[] = Array.isArray(model.tags)
          ? model.tags.filter((t): t is string => typeof t === 'string')
          : [];
        const hasGguf = model.gguf != null && typeof model.gguf === 'object';
        if (ggufOnly && !hasGguf) continue;
        results.push({
          id: String(model.name ?? ''),
          author: String(model.name ?? '').split('/')[0] ?? '',
          downloads: typeof model.downloads === 'number' ? model.downloads : 0,
          likes: typeof model.likes === 'number' ? model.likes : 0,
          tags: tags.slice(0, 20),
          pipelineTag: typeof model.task === 'string' ? model.task : null,
          libraryName: typeof model.library_name === 'string' ? model.library_name : null,
          gated: !!model.gated,
          updatedAt:
            model.updatedAt instanceof Date
              ? model.updatedAt.toISOString()
              : typeof model.updatedAt === 'string'
                ? model.updatedAt
                : null,
          ggufMeta: hasGguf ? extractGgufMeta(model.gguf as Record<string, unknown>) : null,
        });
        if (results.length >= limit) break;
        if (scanned >= maxScan) break;
      }
    } catch (e) {
      throw new Error(`HF search failed: ${(e as Error).message ?? String(e)}`);
    }
    return results;
  }

  /** Full card for a single repo.  Includes GGUF variants if any. */
  async modelInfo(repoId: string): Promise<HFModelCard> {
    if (!isRepoId(repoId)) throw new Error('invalid repoId');
    const mod = await this.loadHubModule();
    try {
      // v4.0.2 deep-debug: full useful expand set per measured API.
      // - cardData: contains license (string), license_link, base_model,
      //   pipeline_tag — the description field on cardData is empty for
      //   the vast majority of repos (the README body isn't surfaced
      //   here at all; the Web ↗ button is the path for that).
      // - siblings: file listing as `{ rfilename }` objects.  Faster
      //   than a separate listFiles() round trip and includes EVERY
      //   file (listFiles paginates).
      // - gguf: structured GGUF metadata (architecture, context_length,
      //   chat_template, totalFileSize).  Only present on GGUF repos.
      // - tags: array of tags.
      // - library_name: e.g. "transformers" or undefined for GGUF.
      const infoRaw = await mod.modelInfo({
        name: repoId,
        additionalFields: ['tags', 'cardData', 'siblings', 'gguf', 'library_name'],
      } as Parameters<typeof mod.modelInfo>[0]);
      const info = infoRaw as ModelInfoLoose;
      // v4.0.2 deep-debug: use listFiles as PRIMARY source (it
      // carries per-file size via paths-info), and merge in any names
      // from `siblings` that listFiles didn't return.  siblings alone
      // has no size data, which broke the hardware FitBadge.
      const files: { path: string; size: number | null }[] = [];
      const seen = new Set<string>();
      try {
        for await (const f of mod.listFiles({ repo: { type: 'model', name: repoId } })) {
          if (typeof f.path !== 'string') continue;
          files.push({
            path: f.path,
            size: typeof f.size === 'number' ? f.size : null,
          });
          seen.add(f.path);
          if (files.length >= 200) break;
        }
      } catch {
        // gated / auth / network — fall through to siblings.
      }
      const siblings = Array.isArray(info.siblings) ? info.siblings : [];
      for (const s of siblings) {
        const fname = (s as { rfilename?: unknown }).rfilename;
        if (typeof fname !== 'string' || seen.has(fname)) continue;
        files.push({ path: fname, size: null });
        seen.add(fname);
      }
      const ggufFiles = files.filter((f) => /\.gguf$/i.test(f.path));
      const gguf: HFGgufVariant[] = ggufFiles.map((f) => ({
        fileName: f.path,
        quant: extractQuantTag(f.path),
        sizeBytes: f.size ?? null,
      }));
      const cardData = (info.cardData ?? {}) as Record<string, unknown>;
      const license =
        typeof cardData.license === 'string'
          ? cardData.license
          : typeof cardData.license_name === 'string'
            ? (cardData.license_name as string)
            : null;
      const licenseLink =
        typeof cardData.license_link === 'string' ? (cardData.license_link as string) : null;
      const cardDescription =
        typeof cardData.description === 'string' && (cardData.description as string).trim().length > 0
          ? (cardData.description as string)
          : null;
      const ggufMeta =
        info.gguf != null && typeof info.gguf === 'object'
          ? extractGgufMeta(info.gguf as Record<string, unknown>)
          : null;
      return {
        id: repoId,
        description: cardDescription,
        downloads: typeof info.downloads === 'number' ? info.downloads : 0,
        likes: typeof info.likes === 'number' ? info.likes : 0,
        tags: Array.isArray(info.tags)
          ? info.tags.filter((t): t is string => typeof t === 'string').slice(0, 60)
          : [],
        pipelineTag: typeof info.task === 'string' ? info.task : null,
        libraryName: typeof info.library_name === 'string' ? info.library_name : null,
        license,
        licenseLink,
        gated: !!info.gated,
        files,
        gguf,
        ggufMeta,
        webUrl: `https://huggingface.co/${repoId}`,
        updatedAt:
          info.updatedAt instanceof Date
            ? info.updatedAt.toISOString()
            : typeof info.updatedAt === 'string'
              ? info.updatedAt
              : null,
        createdAt:
          typeof info.createdAt === 'string' ? info.createdAt : null,
      };
    } catch (e) {
      throw new Error(`HF modelInfo failed: ${(e as Error).message ?? String(e)}`);
    }
  }

  /** Resolved cache directory.  Pure read — no side effects. */
  getCachePath(): string {
    if (this.settings.cachePath) return this.settings.cachePath;
    const homeCache = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
    try {
      if (fs.existsSync(homeCache) && fs.statSync(homeCache).isDirectory()) return homeCache;
    } catch {
      // ignore — fall through to userData
    }
    return path.join(app.getPath('userData'), CACHE_DIR_NAME);
  }

  /** Walk the cache directory and report top-level entries (repo dirs) +
   *  their on-disk size.  Bounded scan; large caches are summarised. */
  listCached(): HFCachedEntry[] {
    const root = this.getCachePath();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: HFCachedEntry[] = [];
    let scanned = 0;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      // Hub layout: `models--<org>--<name>` per repo.
      const id = decodeCacheDir(e.name);
      if (!id) continue;
      const full = path.join(root, e.name);
      const size = directorySizeSafe(full);
      out.push({ id, dirName: e.name, sizeBytes: size });
      scanned++;
      if (scanned > 500) break;
    }
    return out;
  }

  /** Delete a cached repo by id.  Returns whether the directory was found. */
  removeCached(repoId: string): boolean {
    if (!isRepoId(repoId)) throw new Error('invalid repoId');
    const root = this.getCachePath();
    const dirName = `models--${repoId.replace('/', '--')}`;
    const target = path.join(root, dirName);
    // Path-traversal guard: target MUST resolve inside root.
    const targetReal = path.resolve(target);
    const rootReal = path.resolve(root);
    if (!targetReal.startsWith(rootReal + path.sep) && targetReal !== rootReal) {
      throw new Error('cache target escapes the cache root');
    }
    try {
      const st = fs.statSync(target);
      if (!st.isDirectory()) return false;
    } catch {
      return false;
    }
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  }

  // ---- research audit log ----

  /** Append a Research-catalog launch event to the JSONL audit log.
   *  Bounded to MAX_AUDIT_ENTRIES — older entries truncate FIFO. */
  appendAuditEntry(entry: HFAuditEntry): void {
    const auditPath = this.getAuditLogPath();
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    try {
      fs.appendFileSync(auditPath, line, { mode: 0o600 });
    } catch {
      // ignore — best-effort logging
      return;
    }
    // Cap the file by trimming oldest entries when it grows large.
    // Cheap heuristic: only check size occasionally (every 50 appends
    // would be ideal; we approximate by checking when the file is
    // larger than ~MAX_AUDIT_ENTRIES * 200 bytes per line).
    try {
      const stat = fs.statSync(auditPath);
      if (stat.size > MAX_AUDIT_ENTRIES * 256) {
        const all = this.readAuditLog();
        const trimmed = all.slice(-MAX_AUDIT_ENTRIES);
        const next = trimmed.map((e) => JSON.stringify(e)).join('\n') + '\n';
        const tmp = `${auditPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, next, { mode: 0o600 });
        fs.renameSync(tmp, auditPath);
      }
    } catch {
      // ignore — trimming is opportunistic
    }
  }

  readAuditLog(): HFAuditEntry[] {
    const auditPath = this.getAuditLogPath();
    let raw: string;
    try {
      raw = fs.readFileSync(auditPath, 'utf8');
    } catch {
      return [];
    }
    const out: HFAuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Partial<HFAuditEntry>;
        if (typeof parsed.ts !== 'string') continue;
        if (typeof parsed.repoId !== 'string') continue;
        out.push({
          ts: parsed.ts,
          repoId: parsed.repoId,
          quant: typeof parsed.quant === 'string' ? parsed.quant : null,
          note: typeof parsed.note === 'string' ? parsed.note : undefined,
        });
      } catch {
        // skip malformed line
      }
    }
    return out;
  }

  clearAuditLog(): void {
    const auditPath = this.getAuditLogPath();
    try {
      fs.unlinkSync(auditPath);
    } catch {
      // already absent
    }
  }

  private getAuditLogPath(): string {
    return path.join(app.getPath('userData'), AUDIT_LOG_FILE);
  }

  // ---- internals ----

  /** Lazy-load the SDK so the rest of the app doesn't pay the parse cost
   *  unless the user actually opens the HF panel. */
  private async loadHubModule(): Promise<typeof import('@huggingface/hub')> {
    if (this.hfModule) return this.hfModule;
    if (this.hfModuleError) throw new Error(this.hfModuleError);
    try {
      // Dynamic import keeps electron-builder from trying to bundle it
      // into the main entry — it lives in node_modules and is required
      // lazily on first HF call.
      this.hfModule = await import('@huggingface/hub');
      return this.hfModule;
    } catch (e) {
      this.hfModuleError = `@huggingface/hub failed to load: ${(e as Error).message ?? String(e)}`;
      throw new Error(this.hfModuleError);
    }
  }

  private ensureCacheDir(): void {
    const dir = this.getCachePath();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore — first call to a method that touches the dir will surface.
    }
  }

  private readSettings(): HFSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.settingsPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS };
    }
    let parsed: Partial<HFSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
    return {
      researchModeEnabled:
        typeof parsed.researchModeEnabled === 'boolean'
          ? parsed.researchModeEnabled
          : DEFAULT_SETTINGS.researchModeEnabled,
      researchModeAcknowledgedAt:
        typeof parsed.researchModeAcknowledgedAt === 'string'
          ? parsed.researchModeAcknowledgedAt
          : DEFAULT_SETTINGS.researchModeAcknowledgedAt,
      cachePath:
        typeof parsed.cachePath === 'string' && parsed.cachePath.length > 0
          ? parsed.cachePath
          : DEFAULT_SETTINGS.cachePath,
    };
  }

  private writeSettings(next: HFSettings): void {
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    const tmp = `${this.settingsPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.settingsPath);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  }
}

// ---- helpers ----

/**
 * Looser shape of a `ModelEntry` from @huggingface/hub.  The SDK's
 * strict type elides `tags`, `pipeline_tag`, etc. because they're only
 * present when `additionalFields` is requested.  We always request them
 * so the cast is safe — but TypeScript needs the wider type to read.
 */
interface ModelEntryLoose {
  name?: string;
  downloads?: number;
  likes?: number;
  gated?: boolean;
  tags?: unknown[];
  /** @huggingface/hub maps pipeline_tag → `task` on the response. */
  task?: string;
  library_name?: string;
  gguf?: unknown;
  updatedAt?: Date | string;
  createdAt?: string;
}

interface ModelInfoLoose extends ModelEntryLoose {
  description?: string;
  license?: string;
  cardData?: unknown;
  siblings?: unknown[];
}

function extractGgufMeta(g: Record<string, unknown>): HFGgufMetadata {
  return {
    architecture: typeof g.architecture === 'string' ? g.architecture : null,
    contextLength:
      typeof g.context_length === 'number' && Number.isFinite(g.context_length)
        ? (g.context_length as number)
        : null,
    totalParams:
      typeof g.total === 'number' && Number.isFinite(g.total) ? (g.total as number) : null,
    totalFileSize:
      typeof g.totalFileSize === 'number' && Number.isFinite(g.totalFileSize)
        ? (g.totalFileSize as number)
        : null,
    chatTemplate: typeof g.chat_template === 'string' ? g.chat_template : null,
    bosToken: typeof g.bos_token === 'string' ? g.bos_token : null,
    eosToken: typeof g.eos_token === 'string' ? g.eos_token : null,
  };
}

function isSafeFileName(s: unknown): s is string {
  // Refuse path separators, control chars, leading dots/dashes, parent
  // segments — anything that could escape the cache root.
  return (
    typeof s === 'string' &&
    s.length > 0 &&
    s.length <= 256 &&
    /^[A-Za-z0-9_.\-]+$/.test(s) &&
    !s.startsWith('.') &&
    !s.includes('..')
  );
}


function isRepoId(s: unknown): s is string {
  // <org-or-user>/<name>; both sides allow letters, digits, '_', '-', '.'.
  return typeof s === 'string' && /^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(s) && s.length <= 256;
}

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : lo;
  return Math.max(lo, Math.min(hi, x));
}

function extractQuantTag(fileName: string): string | null {
  // v4.0.2 deep-debug: 20 real-filename regression tests in
  // scripts/test-quant-regex.mjs cover this.  Uploaders use either
  // `.`, `-`, or `_` as the separator and either upper- or lower-case
  // quant tags.  We strip `.gguf`, then try each pattern by specificity.
  const base = fileName.replace(/\.gguf$/i, '');
  let m: RegExpMatchArray | null;
  // Q-quants with K_X suffix: Q4_K_M, Q3_K_XL, Q5_K_S
  m = base.match(/[._-](Q\d_K_[A-Z]+)$/i);
  if (m) return m[1].toUpperCase();
  // Q-quants with multi-digit suffix: Q4_0, Q4_0_4_4, Q5_1
  m = base.match(/[._-](Q\d(?:_\d+)+)$/i);
  if (m) return m[1].toUpperCase();
  // I-quants: IQ3_M, IQ4_XS, IQ4_NL
  m = base.match(/[._-](IQ\d_[A-Z]+)$/i);
  if (m) return m[1].toUpperCase();
  // Short forms: _q4, _q8
  m = base.match(/[._-]q(\d)$/i);
  if (m) return `Q${m[1]}`;
  // Float quants
  m = base.match(/[._-](BF16|F16|F32)$/i);
  if (m) return m[1].toUpperCase();
  // Q-quant with single trailing K: Q2_K, Q6_K
  m = base.match(/[._-](Q\d_K)$/i);
  if (m) return m[1].toUpperCase();
  return null;
}

function decodeCacheDir(dirName: string): string | null {
  // Hub layout: 'models--<org>--<name>'
  if (!dirName.startsWith('models--')) return null;
  const stripped = dirName.slice('models--'.length);
  // First '--' separates org from name; later '--' can appear in the
  // repo name itself in the cache layout (Hub uses '--' as a safe
  // separator for filesystem-incompatible characters), so split on
  // the first occurrence only.
  const idx = stripped.indexOf('--');
  if (idx <= 0) return null;
  const org = stripped.slice(0, idx);
  const name = stripped.slice(idx + 2);
  if (!org || !name) return null;
  return `${org}/${name}`;
}

function directorySizeSafe(root: string): number {
  let total = 0;
  let scanned = 0;
  const stack: string[] = [root];
  while (stack.length > 0 && scanned < 5000) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      scanned++;
      if (e.isDirectory()) {
        stack.push(p);
      } else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  return total;
}
