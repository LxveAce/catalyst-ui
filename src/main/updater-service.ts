import { app, autoUpdater } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UpdaterSettings, UpdaterState, UpdateChannel } from '../shared/types';

const STORE_FILE = 'updater-settings.json';

const DEFAULTS: UpdaterSettings = {
  enabled: true,
  channel: 'stable',
};

/**
 * Public callbacks. We don't import NotificationsService here to keep the
 * dependency tree one-way (main wiring composes the two).
 */
export interface UpdaterCallbacks {
  /** Called when the OS-level autoUpdater reports an available, downloaded update. */
  onUpdateDownloaded?: (version: string) => void;
  /** Called for any updater error (non-fatal — typical on first-run / no releases yet). */
  onError?: (message: string) => void;
}

/**
 * UpdaterService wraps `update-electron-app` for the auto-update path AND
 * exposes a manual `checkNow()` plus a settings store.
 *
 * Why update-electron-app (not electron-updater)?
 *   - We use electron-forge with MakerSquirrel, not electron-builder.
 *   - `update-electron-app` is the official Electron helper for Squirrel.Windows
 *     and Squirrel.Mac. It uses Electron's built-in `autoUpdater` module and
 *     defaults to the GitHub-hosted update.electronjs.org proxy, which already
 *     handles release-channel resolution from GitHub Releases.
 *   - No code-signing requirement on Windows for Squirrel installs.
 *     (macOS would need signing, but we ship Windows-first.)
 *
 * Skip conditions:
 *   - dev-mode (MAIN_WINDOW_VITE_DEV_SERVER_URL set): don't init the OS updater
 *     at all — there's no installed app to update.
 *   - Linux: Squirrel-style autoUpdate isn't supported there; surface an
 *     'unsupported-platform' reason rather than failing loudly.
 *   - User disabled: respect it.
 */
export class UpdaterService {
  private storePath: string;
  private settings: UpdaterSettings;
  private state: UpdaterState;
  private callbacks: UpdaterCallbacks;
  private wired = false;
  /** Floor between checkNow invocations to prevent renderer-side spam. */
  private lastCheckNowAt = 0;
  private static CHECK_NOW_MIN_INTERVAL_MS = 5000;

  constructor(opts: { isDevMode: boolean; callbacks?: UpdaterCallbacks }) {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.settings = this.read();
    this.callbacks = opts.callbacks ?? {};

    const currentVersion = app.getVersion();
    const productionMode = !opts.isDevMode;

    this.state = {
      currentVersion,
      productionMode,
      active: false,
      inactiveReason: opts.isDevMode ? 'dev-mode' : null,
      channel: this.settings.channel,
      lastCheckedAt: null,
      lastUpdateFoundAt: null,
      pendingVersion: null,
      lastError: null,
    };
  }

  /**
   * Wire up the OS auto-updater. Safe to call once per process.
   * Returns the new state for telemetry.
   */
  start(): UpdaterState {
    if (this.wired) return this.getState();
    this.wired = true;

    // Skip in dev mode — no installed app to update.
    if (!this.state.productionMode) {
      this.state.inactiveReason = 'dev-mode';
      return this.getState();
    }

    // Squirrel.Windows + Squirrel.Mac only.
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      this.state.inactiveReason = 'unsupported-platform';
      return this.getState();
    }

    // Respect user disable.
    if (!this.settings.enabled) {
      this.state.inactiveReason = 'disabled';
      return this.getState();
    }

    try {
      // Dynamic require so dev-mode and unsupported-platform paths don't
      // need the module on disk during typecheck or first-run launches.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { updateElectronApp, UpdateSourceType } = require('update-electron-app') as {
        updateElectronApp: (opts: Record<string, unknown>) => void;
        UpdateSourceType: { ElectronPublicUpdateService: string };
      };

      updateElectronApp({
        updateSource: {
          type: UpdateSourceType.ElectronPublicUpdateService,
          // update.electronjs.org expects "owner/repo" — pulled at runtime
          // from package.json author/repo or env. For our app we hard-code
          // the GitHub slug since the publisher target is the same repo.
          //
          // CHANNEL NOTE: update.electronjs.org currently serves the latest
          // non-prerelease tag only. The `channel` setting (stable/beta) is
          // stored for UX intent but the feed does NOT split routes today.
          // To enable a real beta channel, either:
          //   (a) host a separate GitHub repo for beta releases and switch
          //       `repo` based on settings.channel here, OR
          //   (b) run a custom update server (e.g. Nuts/Nucleus) that filters
          //       by prerelease flag.
          repo: 'LxveAce/claude-code-studio',
          host: 'https://update.electronjs.org',
        },
        // 1 hour — long enough to avoid hammering, short enough to land
        // a release within the same workday a user keeps the app open.
        updateInterval: '1 hour',
        // Don't pop a native dialog — we route via Notifications service.
        notifyUser: false,
        logger: {
          log: (...args: unknown[]) => {
            // Mirror to state.lastCheckedAt for visibility.
            this.state.lastCheckedAt = new Date().toISOString();
            // eslint-disable-next-line no-console
            console.log('[updater]', ...args);
          },
          info: (...args: unknown[]) => {
            // eslint-disable-next-line no-console
            console.info('[updater]', ...args);
          },
          warn: (...args: unknown[]) => {
            // eslint-disable-next-line no-console
            console.warn('[updater]', ...args);
          },
          error: (...args: unknown[]) => {
            // eslint-disable-next-line no-console
            console.error('[updater]', ...args);
          },
        },
      });

      // Hook the underlying Electron autoUpdater for ground truth events.
      autoUpdater.on('checking-for-update', () => {
        this.state.lastCheckedAt = new Date().toISOString();
      });
      autoUpdater.on(
        'update-downloaded',
        (
          _event: unknown,
          _releaseNotes: string,
          releaseName: string,
        ) => {
          const version = typeof releaseName === 'string' ? releaseName : '';
          this.state.lastUpdateFoundAt = new Date().toISOString();
          this.state.pendingVersion = version || null;
          try {
            this.callbacks.onUpdateDownloaded?.(version);
          } catch {
            // never let UI bookkeeping crash the updater
          }
        },
      );
      autoUpdater.on('error', (err: Error) => {
        const msg = err && err.message ? err.message : String(err);
        this.state.lastError = msg;
        try {
          this.callbacks.onError?.(msg);
        } catch {
          // ignore
        }
      });

      this.state.active = true;
      this.state.inactiveReason = null;
      return this.getState();
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      this.state.active = false;
      this.state.inactiveReason = 'init-error';
      this.state.lastError = msg;
      return this.getState();
    }
  }

  /**
   * Trigger an immediate check. No-op (but updates lastError) when inactive.
   * Squirrel.Windows / autoUpdater.checkForUpdates is throttled at the OS
   * level so spamming this from the UI is safe.
   */
  checkNow(): UpdaterState {
    if (!this.state.active) {
      this.state.lastError =
        this.state.inactiveReason === 'dev-mode'
          ? 'Auto-update is disabled in development mode.'
          : this.state.inactiveReason === 'unsupported-platform'
            ? 'Auto-update is not supported on this platform.'
            : this.state.inactiveReason === 'disabled'
              ? 'Auto-update is disabled in settings.'
              : (this.state.lastError ?? 'Auto-updater is not active.');
      return this.getState();
    }
    // Throttle to prevent renderer-side spam from hammering Squirrel/Update.exe.
    // Returning cached state is safe — autoUpdater is internally async; if a
    // check is genuinely in-flight the caller already has fresh `lastCheckedAt`.
    const now = Date.now();
    if (now - this.lastCheckNowAt < UpdaterService.CHECK_NOW_MIN_INTERVAL_MS) {
      return this.getState();
    }
    this.lastCheckNowAt = now;
    try {
      autoUpdater.checkForUpdates();
      this.state.lastCheckedAt = new Date().toISOString();
      // Don't clear lastError here — the OS may report one asynchronously.
    } catch (e) {
      this.state.lastError = (e as Error).message ?? String(e);
    }
    return this.getState();
  }

  getState(): UpdaterState {
    // Always re-emit channel from settings in case user changed it.
    return { ...this.state, channel: this.settings.channel };
  }

  getSettings(): UpdaterSettings {
    return { ...this.settings };
  }

  setSettings(partial: Partial<UpdaterSettings>): UpdaterSettings {
    const next: UpdaterSettings = { ...this.settings };
    if (partial.enabled !== undefined) {
      if (typeof partial.enabled !== 'boolean') {
        throw new Error('enabled must be boolean');
      }
      next.enabled = partial.enabled;
    }
    if (partial.channel !== undefined) {
      if (partial.channel !== 'stable' && partial.channel !== 'beta') {
        throw new Error('channel must be "stable" or "beta"');
      }
      next.channel = partial.channel;
    }
    this.settings = next;
    this.write();
    // Note: changing settings does not retroactively un-wire the OS updater.
    // Toggling `enabled` requires app restart to take effect; we surface
    // this in the UI copy. This matches update-electron-app's contract.
    return { ...this.settings };
  }

  // --- internals ---

  private read(): UpdaterSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULTS };
      return { ...DEFAULTS };
    }
    let parsed: Partial<UpdaterSettings>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...DEFAULTS };
    }
    const channel: UpdateChannel =
      parsed.channel === 'stable' || parsed.channel === 'beta'
        ? parsed.channel
        : DEFAULTS.channel;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      channel,
    };
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
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
