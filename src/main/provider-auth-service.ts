import { app, safeStorage } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AuthSource, ProviderAuthEntry, ProviderId } from '../shared/types';

const STORE_FILE = 'provider-auth.json';
const KNOWN_PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'openrouter'];
const MAX_KEY_LEN = 1024;

/** Maps a `ModelDefinition.provider` (display name like "Anthropic" / "Google")
 *  to a canonical `ProviderId`. Returns null for providers that don't need
 *  an API key (Ollama, local, etc.). */
export function normalizeProvider(displayName: string): ProviderId | null {
  const n = displayName.toLowerCase().trim();
  if (n === 'anthropic') return 'anthropic';
  if (n === 'openai') return 'openai';
  if (n === 'google' || n === 'gemini') return 'gemini';
  if (n === 'openrouter') return 'openrouter';
  return null;
}

/** Env var the spawned CLI looks for, per provider. */
export const PROVIDER_ENV_KEY: Record<ProviderId, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

interface StoreEntry {
  /** Base64 of `safeStorage.encryptString(rawKey)`. Present only when OS
   *  keychain is available (typical case). */
  encryptedKey?: string;
  /** Plaintext fallback for systems without `safeStorage` (e.g. headless
   *  Linux without a logged-in keyring). Only written if the caller passes
   *  `allowPlaintext: true`. Off by default; UI surfaces a warning. */
  plainKey?: string;
  lastUpdated: string; // ISO 8601
}

type StoreShape = Partial<Record<ProviderId, StoreEntry>>;

export class ProviderAuthService {
  private static singleton: ProviderAuthService | null = null;
  private storePath: string;
  private store: StoreShape;

  static instance(): ProviderAuthService {
    if (!ProviderAuthService.singleton) {
      ProviderAuthService.singleton = new ProviderAuthService();
    }
    return ProviderAuthService.singleton;
  }

  private constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.store = this.read();
  }

  /** Renderer-visible — returns true if we have a key on file for this provider. */
  hasKey(provider: ProviderId): boolean {
    return Boolean(this.getRawKey(provider));
  }

  /** List all known providers with presence + last-updated + auto-detected
   *  source so the UI can show "already authenticated via Claude CLI" etc. */
  list(): ProviderAuthEntry[] {
    const detected = this.detectExisting();
    return KNOWN_PROVIDERS.map((p) => {
      const entry = this.store[p];
      return {
        provider: p,
        hasKey: this.hasKey(p),
        lastUpdated: entry?.lastUpdated ?? null,
        source: detected[p],
      };
    });
  }

  setKey(provider: ProviderId, key: string, allowPlaintext = false): ProviderAuthEntry[] {
    if (!KNOWN_PROVIDERS.includes(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    const trimmed = key.trim();
    if (!trimmed) throw new Error('Key cannot be empty');
    if (trimmed.length > MAX_KEY_LEN) {
      throw new Error(`Key exceeds ${MAX_KEY_LEN} chars`);
    }

    const canEncrypt = safeStorage.isEncryptionAvailable();
    if (!canEncrypt && !allowPlaintext) {
      throw new Error(
        'OS keychain (safeStorage) is not available on this system. ' +
          'Refusing to store the API key in plaintext. Unlock your keychain ' +
          'and try again, or pass allowPlaintext to acknowledge the risk.'
      );
    }

    const nextEntry: StoreEntry = {
      lastUpdated: new Date().toISOString(),
    };
    if (canEncrypt) {
      nextEntry.encryptedKey = safeStorage.encryptString(trimmed).toString('base64');
    } else {
      nextEntry.plainKey = trimmed;
    }

    this.store = { ...this.store, [provider]: nextEntry };
    this.write();
    return this.list();
  }

  delete(provider: ProviderId): ProviderAuthEntry[] {
    if (!KNOWN_PROVIDERS.includes(provider)) {
      throw new Error(`Unknown provider: ${provider}`);
    }
    const next = { ...this.store };
    delete next[provider];
    this.store = next;
    this.write();
    return this.list();
  }

  /** Main-process-internal: get the raw decrypted key for env injection.
   *  NEVER expose this over IPC. */
  getRawKey(provider: ProviderId): string | null {
    const entry = this.store[provider];
    if (!entry) return null;
    if (entry.encryptedKey) {
      try {
        return safeStorage.decryptString(Buffer.from(entry.encryptedKey, 'base64'));
      } catch {
        // Keychain unlocked changed / migration — treat as absent.
        return null;
      }
    }
    if (entry.plainKey) return entry.plainKey;
    return null;
  }

  /** Compute the env vars to inject when spawning a PTY for a given provider.
   *  Returns empty object if no key on file. */
  envForProvider(provider: ProviderId): Record<string, string> {
    const raw = this.getRawKey(provider);
    if (!raw) return {};
    const envKey = PROVIDER_ENV_KEY[provider];
    return { [envKey]: raw };
  }

  /**
   * For each known provider, detect whether *some* form of auth is already
   * present on the host so the UI doesn't pester the user to enter a key
   * when their CLI is already wired up.
   *
   * Sources we recognize:
   *   - 'stored': our safeStorage entry (the canonical "we have a key").
   *   - 'env': the standard env var is already set in `process.env`
   *     (inherited from the shell that launched the app). Spawned PTYs
   *     inherit this too, so we don't need our own copy.
   *   - 'cli-oauth' (Anthropic only): `~/.claude.json` exists with a
   *     non-empty `oauthAccount` block, OR `~/.claude/oauth_*.json` file.
   *     The actual token is not exportable; we just acknowledge it.
   *   - 'none': nothing detected.
   */
  detectExisting(): Record<ProviderId, AuthSource> {
    const out: Record<ProviderId, AuthSource> = {
      anthropic: 'none',
      openai: 'none',
      gemini: 'none',
      openrouter: 'none',
    };
    for (const p of KNOWN_PROVIDERS) {
      if (this.hasKey(p)) {
        out[p] = 'stored';
        continue;
      }
      const envName = PROVIDER_ENV_KEY[p];
      const envVal = process.env[envName];
      if (typeof envVal === 'string' && envVal.trim().length > 0) {
        out[p] = 'env';
        continue;
      }
    }
    // Special case: Anthropic also accepts OAuth via `claude /login`. The
    // resulting token lives in the user's Claude config dir; check the
    // most likely paths without parsing the file (the token's existence
    // is what we care about, not its value).
    if (out.anthropic === 'none') {
      try {
        const home = os.homedir();
        const candidates = [
          path.join(home, '.claude.json'),
          path.join(home, '.claude', 'oauth_token.json'),
          path.join(home, '.claude', 'auth.json'),
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            // .claude.json is a settings file — having it doesn't prove
            // auth. Check for any non-trivial content.
            try {
              const raw = fs.readFileSync(c, 'utf8');
              if (
                raw.includes('oauthAccount') ||
                raw.includes('access_token') ||
                raw.includes('refresh_token')
              ) {
                out.anthropic = 'cli-oauth';
                break;
              }
            } catch {
              // unreadable — skip
            }
          }
        }
      } catch {
        // ignore — defaults to 'none'
      }
    }
    return out;
  }

  private read(): StoreShape {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: StoreShape = {};
    for (const p of KNOWN_PROVIDERS) {
      const v = (parsed as Record<string, unknown>)[p];
      if (!v || typeof v !== 'object') continue;
      const entry = v as Partial<StoreEntry>;
      if (typeof entry.lastUpdated !== 'string') continue;
      const next: StoreEntry = { lastUpdated: entry.lastUpdated };
      if (typeof entry.encryptedKey === 'string') next.encryptedKey = entry.encryptedKey;
      if (typeof entry.plainKey === 'string') next.plainKey = entry.plainKey;
      result[p] = next;
    }
    return result;
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.storePath);
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
