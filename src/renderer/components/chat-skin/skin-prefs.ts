/**
 * Per-pane chat-skin preference, persisted in localStorage so the user's
 * "this pane uses the chat skin" choice survives reloads + restarts.
 *
 * Key shape: `chat-skin:<paneId>` → `"1"` (skin on) or `"0"` / missing (off).
 *
 * Why localStorage vs the session JSON: this is a renderer-only preference
 * that doesn't need to round-trip to main. Cheap to keep here.
 */

const KEY_PREFIX = 'chat-skin:';

export function isSkinEnabled(paneId: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + paneId) === '1';
  } catch {
    return false;
  }
}

export function setSkinEnabled(paneId: string, enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(KEY_PREFIX + paneId, '1');
    } else {
      localStorage.removeItem(KEY_PREFIX + paneId);
    }
  } catch {
    // localStorage quota / private mode — silently ignore.
  }
}

/** Clear the preference for a paneId that was destroyed. */
export function forgetSkin(paneId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + paneId);
  } catch {
    // ignore
  }
}
