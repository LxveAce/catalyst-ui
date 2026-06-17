import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WindowState, WindowStateMap } from '../shared/types';

const STORE_FILE = 'window-state.json';
const MAX_TRACKED_WINDOWS = 64;
const SAVE_DEBOUNCE_MS = 500;

export class WindowStateService {
  private storePath: string;
  private states: WindowStateMap;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.states = this.read();
  }

  /**
   * Look up a saved state. Returns the saved state if the window would still
   * appear on a connected display; otherwise returns `defaults`. This is the
   * "monitor was unplugged" case — without the visibility check the window
   * opens off-screen and the user can't get to it.
   */
  loadState(id: string, defaults: WindowState): WindowState {
    const saved = this.states[id];
    if (!saved) return defaults;
    if (!isOnAnyDisplay(saved)) return defaults;
    return { ...saved };
  }

  /**
   * Persist size/position changes on the given window under `id`. Listens to
   * resize, move, maximize/unmaximize, and close — debounced to once per
   * SAVE_DEBOUNCE_MS so a drag doesn't fsync per pixel.
   */
  bindWindow(id: string, win: BrowserWindow): void {
    const capture = () => {
      if (win.isDestroyed()) return;
      const maximized = win.isMaximized();
      // When maximized, getBounds returns the maximized rect — not useful for
      // restoring an unmaximized size. Use getNormalBounds to capture the
      // pre-maximize geometry instead.
      const bounds = maximized ? win.getNormalBounds() : win.getBounds();
      const next: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized,
      };
      const prev = this.states[id];
      if (
        prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height &&
        prev.maximized === next.maximized
      ) {
        return;
      }
      this.states[id] = next;
      this.scheduleWrite();
    };

    win.on('resize', capture);
    win.on('move', capture);
    win.on('maximize', capture);
    win.on('unmaximize', capture);
    win.on('close', () => {
      capture();
      this.flush();
    });
  }

  /**
   * Drop a window's saved state (e.g., model pop-out paneId that's been
   * destroyed). Keeps the store from growing unbounded.
   */
  forget(id: string): void {
    if (!(id in this.states)) return;
    delete this.states[id];
    this.scheduleWrite();
  }

  /** Force-flush any pending debounced writes. Called on app quit. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.write();
  }

  private scheduleWrite(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.write();
      } catch {
        // Window state persistence must never crash the app.
      }
    }, SAVE_DEBOUNCE_MS);
  }

  private read(): WindowStateMap {
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
    const result: WindowStateMap = {};
    let count = 0;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (count >= MAX_TRACKED_WINDOWS) break;
      const validated = validateState(v);
      if (validated) {
        result[k] = validated;
        count += 1;
      }
    }
    return result;
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.states, null, 2), { mode: 0o600 });
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

function validateState(v: unknown): WindowState | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<WindowState>;
  if (
    typeof o.x !== 'number' ||
    typeof o.y !== 'number' ||
    typeof o.width !== 'number' ||
    typeof o.height !== 'number' ||
    typeof o.maximized !== 'boolean'
  ) {
    return null;
  }
  if (o.width < 100 || o.height < 100 || o.width > 10000 || o.height > 10000) {
    return null;
  }
  return { x: o.x, y: o.y, width: o.width, height: o.height, maximized: o.maximized };
}

function isOnAnyDisplay(state: WindowState): boolean {
  try {
    const displays = screen.getAllDisplays();
    const rect: Rectangle = {
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    };
    return displays.some((d) => rectsIntersect(d.workArea, rect));
  } catch {
    return false;
  }
}

function rectsIntersect(a: Rectangle, b: Rectangle): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
