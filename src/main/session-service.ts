import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PersistedTab, SessionState } from '../shared/types';

const STORE_FILE = 'session.json';
const STORE_VERSION = 2;

/**
 * Hard caps to keep the persisted state from growing into a denial-of-service
 * (huge JSON written to disk, huge tab strip rendered, etc.). Trees/arrays
 * that exceed any cap are treated as malformed and replaced with defaults.
 */
const MAX_TABS = 32;
const MAX_LABEL_LEN = 200;
const MAX_ID_LEN = 64;
const ID_PATTERN = /^[A-Za-z0-9_\-:]+$/;
const VALID_PANEL_IDS = new Set([
  'terminal',
  'commands',
  'resources',
  'github',
  'cost',
  'compact',
  'lmm',
  'sync',
  'auth',
  'settings',
  'models',
  'files',
  'hf',
]);

interface PersistedSession {
  version: number;
  state: SessionState;
}

export class SessionService {
  private storePath: string;
  private state: SessionState;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.state = this.read();
  }

  get(): SessionState {
    // Defensive copy so callers can't mutate the in-memory state by reference.
    return JSON.parse(JSON.stringify(this.state)) as SessionState;
  }

  /**
   * Replace the full session state. Caller (the renderer) is responsible for
   * computing the merged state from current UI; we validate and persist.
   */
  set(next: SessionState): SessionState {
    const sanitized = this.sanitize(next);
    this.state = sanitized;
    this.write();
    return this.get();
  }

  /** Reset to factory defaults; used by the palette "Reset tabs" action. */
  reset(): SessionState {
    this.state = this.defaults();
    this.write();
    return this.get();
  }

  // --- internals ---

  private defaults(): SessionState {
    // Single Claude tab with the historical `p_root` paneId so that any
    // alive PTY from a hot-reload reattaches instead of orphaning.
    const rootTab: PersistedTab = {
      id: 'tab_root',
      label: 'Claude',
      paneId: 'p_root',
      profile: 'claude',
    };
    return {
      version: STORE_VERSION,
      activePanel: 'terminal',
      theme: null,
      tabs: [rootTab],
      activeTabId: rootTab.id,
    };
  }

  private sanitize(input: unknown): SessionState {
    if (!input || typeof input !== 'object') return this.defaults();
    const obj = input as Record<string, unknown>;
    const activePanel =
      typeof obj.activePanel === 'string' && VALID_PANEL_IDS.has(obj.activePanel)
        ? (obj.activePanel as SessionState['activePanel'])
        : 'terminal';
    const theme = typeof obj.theme === 'string' && obj.theme.length <= 64
      ? obj.theme
      : null;

    const tabs = this.sanitizeTabs(obj.tabs);
    // activeTabId must reference an existing tab; otherwise focus the first
    // tab (or null when there are none).
    let activeTabId: string | null = null;
    if (typeof obj.activeTabId === 'string' && tabs.some((t) => t.id === obj.activeTabId)) {
      activeTabId = obj.activeTabId;
    } else if (tabs.length > 0) {
      activeTabId = tabs[0].id;
    }

    return {
      version: STORE_VERSION,
      activePanel,
      theme,
      tabs,
      activeTabId,
    };
  }

  private sanitizeTabs(raw: unknown): PersistedTab[] {
    if (!Array.isArray(raw)) return this.defaults().tabs;
    const out: PersistedTab[] = [];
    const seenIds = new Set<string>();
    const seenPanes = new Set<string>();
    for (const item of raw) {
      if (out.length >= MAX_TABS) break;
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;

      const id = typeof t.id === 'string' ? t.id : null;
      const paneId = typeof t.paneId === 'string' ? t.paneId : null;
      const profile = typeof t.profile === 'string' ? t.profile : null;
      const rawLabel = typeof t.label === 'string' ? t.label : null;

      if (!id || !paneId || !profile) continue;
      if (id.length === 0 || id.length > MAX_ID_LEN) continue;
      if (paneId.length === 0 || paneId.length > MAX_ID_LEN) continue;
      if (!ID_PATTERN.test(id) || !ID_PATTERN.test(paneId)) continue;
      // Only Claude tabs are persisted. Model PTYs die on app quit; reviving
      // them silently on the next launch would surprise users with downloads
      // or GPU spin-up they didn't ask for. The Models panel handles relaunch.
      if (profile !== 'claude') continue;
      if (seenIds.has(id)) continue;
      if (seenPanes.has(paneId)) continue;
      seenIds.add(id);
      seenPanes.add(paneId);

      const label = rawLabel && rawLabel.length <= MAX_LABEL_LEN ? rawLabel : 'Claude';
      const tab: PersistedTab = { id, label, paneId, profile };
      // Preserve the per-launch skip-permissions choice so the tab label
      // stays accurate across a restart/reattach (the flag itself only
      // applies at spawn time).
      if (t.skipPermissions === true) tab.skipPermissions = true;
      out.push(tab);
    }
    // Empty input → defaults (one Claude tab). Prevents a renderer race where
    // a transient empty save would lock the user out until manual reset.
    if (out.length === 0) return this.defaults().tabs;
    return out;
  }

  private read(): SessionState {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults();
      // Don't blow up startup; degrade to defaults but leave the bad file on disk
      // (it will be overwritten on the next successful save).
      return this.defaults();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.defaults();
    }
    if (!parsed || typeof parsed !== 'object') return this.defaults();
    const p = parsed as Partial<PersistedSession> & { version?: unknown };
    const rawVersion = typeof p.version === 'number' && Number.isInteger(p.version)
      ? p.version
      : null;
    if (rawVersion === null) return this.defaults();
    if (rawVersion > STORE_VERSION) {
      // From-the-future file: a newer build wrote it. We don't know the shape,
      // so don't try — just start fresh rather than mis-sanitize.
      return this.defaults();
    }
    if (rawVersion < STORE_VERSION) {
      const migrated = this.migrate(p, rawVersion);
      if (!migrated) return this.defaults();
      return this.sanitize(migrated.state);
    }
    return this.sanitize(p.state);
  }

  /**
   * Step-by-step forward migration from `from` to STORE_VERSION.
   * Returns null to refuse the migration (caller falls back to defaults).
   */
  private migrate(p: Partial<PersistedSession>, from: number): PersistedSession | null {
    let v = from;
    let current: unknown = p.state;

    // v1 → v2: collapse the old SplitNode `layout` tree into a single Claude
    // tab carrying the first pane's id. Preserving the original paneId means
    // an alive PTY (e.g. across hot-reload in dev) reattaches instead of
    // being orphaned. All other panes are dropped — splits are gone in v2.
    if (v === 1) {
      if (!current || typeof current !== 'object') return null;
      const v1 = current as Record<string, unknown>;
      const firstPaneId = extractFirstPaneId(v1.layout);
      const rootTab: PersistedTab = {
        id: 'tab_root',
        label: 'Claude',
        paneId: firstPaneId ?? 'p_root',
        profile: 'claude',
      };
      const v2: SessionState = {
        version: 2,
        activePanel: typeof v1.activePanel === 'string'
          ? (v1.activePanel as SessionState['activePanel'])
          : 'terminal',
        theme: typeof v1.theme === 'string' ? v1.theme : null,
        tabs: [rootTab],
        activeTabId: rootTab.id,
      };
      current = v2;
      v = 2;
    }

    if (v !== STORE_VERSION) return null;
    return {
      version: STORE_VERSION,
      state: (current ?? this.defaults()) as SessionState,
    };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const payload: PersistedSession = {
      version: STORE_VERSION,
      state: this.state,
    };
    const tmp = `${this.storePath}.${process.pid}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
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

/**
 * Walk a v1 SplitNode and return the id of the first pane found (depth-first,
 * left-biased). Returns null if the input isn't a recognizable v1 layout —
 * caller falls back to `p_root`.
 */
function extractFirstPaneId(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  if (n.type === 'pane' && typeof n.id === 'string' && ID_PATTERN.test(n.id)) {
    return n.id;
  }
  if (n.type === 'split' && Array.isArray(n.children) && n.children.length > 0) {
    return extractFirstPaneId(n.children[0]);
  }
  return null;
}
