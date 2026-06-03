import { app, safeStorage } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { URL } from 'node:url';
import type { BrainRestCallResult, BrainRestStatus, BrainRestTestResult } from '../shared/types';

/**
 * BrainRestAuth — credential store for the (bring-your-own) Obsidian
 * **Local REST API** community plugin (coddingtonbear), so Catalyst's
 * MCP-capable models can drive a running Obsidian vault. Mirrors the GitHub-PAT
 * pattern: the API key is encrypted at rest via Electron `safeStorage` and the
 * raw key NEVER crosses back to the renderer — only `hasKey` + the base URL do.
 *
 * This is interop with the *user's own* Obsidian; Catalyst never ships or
 * automates the Obsidian binary (ToS). The key is optional — the Brain works
 * fully via the direct filesystem without it.
 */

const STORE_FILE = 'brain-rest-auth.json';
const DEFAULT_BASE_URL = 'https://127.0.0.1:27124';

interface Persisted {
  baseUrl: string;
  /** Base64 of safeStorage.encryptString(key); absent when no key set. */
  encryptedKey?: string;
}

export class BrainRestAuth {
  private static _instance: BrainRestAuth | null = null;
  static instance(): BrainRestAuth {
    if (!this._instance) this._instance = new BrainRestAuth();
    return this._instance;
  }

  private storePath(): string {
    return path.join(app.getPath('userData'), STORE_FILE);
  }

  private read(): Persisted {
    try {
      const raw = fs.readFileSync(this.storePath(), 'utf8');
      const p = JSON.parse(raw) as Persisted;
      return { baseUrl: typeof p.baseUrl === 'string' && p.baseUrl ? p.baseUrl : DEFAULT_BASE_URL, encryptedKey: typeof p.encryptedKey === 'string' ? p.encryptedKey : undefined };
    } catch {
      return { baseUrl: DEFAULT_BASE_URL };
    }
  }

  private write(p: Persisted): void {
    const target = this.storePath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(p, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, target);
    } catch {
      // Non-fatal.
    }
  }

  status(): BrainRestStatus {
    const p = this.read();
    return {
      hasKey: !!p.encryptedKey,
      baseUrl: p.baseUrl,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  /** Persist the base URL and (optionally) the API key. Empty key clears it. */
  setKey(baseUrl: string, key: string): BrainRestStatus {
    const p = this.read();
    if (typeof baseUrl === 'string' && baseUrl.trim().length > 0 && baseUrl.length <= 2048) {
      p.baseUrl = baseUrl.trim();
    }
    const trimmed = typeof key === 'string' ? key.trim() : '';
    if (trimmed.length === 0) {
      delete p.encryptedKey;
    } else if (safeStorage.isEncryptionAvailable()) {
      p.encryptedKey = safeStorage.encryptString(trimmed).toString('base64');
    } else {
      // No OS keychain — refuse to persist a plaintext secret; keep baseUrl.
      delete p.encryptedKey;
    }
    this.write(p);
    return this.status();
  }

  clear(): BrainRestStatus {
    const p = this.read();
    delete p.encryptedKey;
    this.write(p);
    return this.status();
  }

  /** Internal — never exposed over IPC. */
  private getKey(): string | null {
    const p = this.read();
    if (!p.encryptedKey) return null;
    try {
      return safeStorage.decryptString(Buffer.from(p.encryptedKey, 'base64'));
    } catch {
      return null;
    }
  }

  /**
   * Best-effort connectivity test against the Local REST API root. The plugin
   * defaults to HTTPS with a SELF-SIGNED cert, which Node's fetch rejects — we
   * surface that as a specific, actionable hint rather than a raw error.
   */
  async test(): Promise<BrainRestTestResult> {
    const { baseUrl } = this.read();
    const key = this.getKey();
    if (!key) return { ok: false, status: null, error: 'no-key' };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      return { ok: res.ok, status: res.status, error: res.ok ? null : `http-${res.status}` };
    } catch (e) {
      const msg = String((e as Error).message || e);
      // Self-signed cert is the overwhelmingly common failure for this plugin.
      if (/certificate|self.signed|TLS|SSL/i.test(msg)) {
        return { ok: false, status: null, error: 'self-signed-cert' };
      }
      return { ok: false, status: null, error: 'unreachable' };
    }
  }

  // --- live-vault operations (the mcp-obsidian tool set) --------------------
  // These let Catalyst (and MCP-capable models, via IPC) drive a RUNNING
  // Obsidian vault through the Local REST API plugin. Read ops are safe to
  // surface in the UI; write/delete are exposed over IPC for intentional use.

  /** List files at the vault root, or within `dir`. */
  listFiles(dir?: string): Promise<BrainRestCallResult> {
    const p = dir && dir.trim() ? `vault/${encodeVaultPath(dir)}/` : 'vault/';
    return this.call('GET', p);
  }

  /** Get a file's contents from the live vault. */
  getFile(filePath: string): Promise<BrainRestCallResult> {
    return this.call('GET', `vault/${encodeVaultPath(filePath)}`);
  }

  /** Full-text search across the live vault (simple query). */
  search(query: string): Promise<BrainRestCallResult> {
    return this.call('POST', 'search/simple/', { query: { query: String(query ?? '') } });
  }

  /** Append markdown to a vault file (creates it if missing). */
  append(filePath: string, content: string): Promise<BrainRestCallResult> {
    return this.call('POST', `vault/${encodeVaultPath(filePath)}`, {
      bodyText: String(content ?? ''),
      contentType: 'text/markdown',
    });
  }

  /** Create/overwrite a vault file. */
  put(filePath: string, content: string): Promise<BrainRestCallResult> {
    return this.call('PUT', `vault/${encodeVaultPath(filePath)}`, {
      bodyText: String(content ?? ''),
      contentType: 'text/markdown',
    });
  }

  /** Delete a vault file. */
  deleteFile(filePath: string): Promise<BrainRestCallResult> {
    return this.call('DELETE', `vault/${encodeVaultPath(filePath)}`);
  }

  /**
   * Low-level request to the Local REST API. Uses Node http/https so we can
   * accept the plugin's SELF-SIGNED cert — but ONLY for loopback hosts. For any
   * non-loopback https target we keep normal cert validation on, so the key is
   * never sent to an untrusted host over an unverified channel.
   */
  private call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    urlPath: string,
    opts: { query?: Record<string, string>; bodyText?: string; contentType?: string } = {}
  ): Promise<BrainRestCallResult> {
    const { baseUrl } = this.read();
    const key = this.getKey();
    if (!key) return Promise.resolve({ ok: false, status: null, data: null, error: 'no-key' });

    let url: URL;
    try {
      url = new URL(urlPath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    } catch {
      return Promise.resolve({ ok: false, status: null, data: null, error: 'bad-url' });
    }
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }
    const isHttps = url.protocol === 'https:';
    const isLoopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
    const mod = isHttps ? https : http;

    return new Promise<BrainRestCallResult>((resolve) => {
      const req = mod.request(
        url,
        {
          method,
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: 'application/json',
            ...(opts.bodyText != null ? { 'Content-Type': opts.contentType ?? 'text/markdown' } : {}),
          },
          // Self-signed cert is accepted ONLY for loopback (the plugin default).
          ...(isHttps ? { rejectUnauthorized: !isLoopback } : {}),
          timeout: 6000,
        },
        (res) => {
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', (d) => (buf += d));
          res.on('end', () => {
            let data: unknown = buf;
            if (/json/i.test(String(res.headers['content-type'] ?? ''))) {
              try {
                data = JSON.parse(buf);
              } catch {
                /* keep raw */
              }
            }
            const status = res.statusCode ?? 0;
            const ok = status >= 200 && status < 300;
            resolve({ ok, status, data, error: ok ? null : `http-${status}` });
          });
        }
      );
      req.on('error', (e) => {
        const msg = String((e as Error).message || e);
        resolve({
          ok: false,
          status: null,
          data: null,
          error: /certificate|self.signed|TLS|SSL/i.test(msg) ? 'self-signed-cert' : 'unreachable',
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: null, data: null, error: 'timeout' });
      });
      if (opts.bodyText != null) req.write(opts.bodyText);
      req.end();
    });
  }
}

/** Encode a vault-relative path for the REST URL (per-segment; blocks `..`). */
function encodeVaultPath(p: string): string {
  return String(p)
    .split('/')
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .map(encodeURIComponent)
    .join('/');
}
