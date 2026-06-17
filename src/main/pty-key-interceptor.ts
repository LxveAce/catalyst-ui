import { EventEmitter } from 'events';
import type { ProviderId } from '../shared/types';

/**
 * Per-CLI regex patterns that indicate "the spawned tool is now interactively
 * asking the user for an API key." Each pattern is intentionally narrow —
 * substring-anchored to a known prompt string — so we don't false-positive
 * on user prose that happens to include the words "API key."
 *
 * If a CLI prompt shape changes between versions, the worst case is the
 * interceptor stops firing and the user has to set the key via Settings;
 * we never inject the wrong key.
 */
const PROMPT_PATTERNS: Partial<Record<ProviderId, RegExp[]>> = {
  // aider asks: "Enter your OpenAI API key (or paste it here): "
  openai: [
    /Enter your OpenAI API key/i,
    /OPENAI_API_KEY is not set/i,
    /Please enter your OpenAI API key/i,
  ],
  // aider for anthropic: "Enter your Anthropic API key …"
  anthropic: [
    /Enter your Anthropic API key/i,
    /ANTHROPIC_API_KEY is not set/i,
  ],
  // gemini-cli: "Please enter your Gemini API key:"
  gemini: [
    /Please enter your Gemini API key/i,
    /GEMINI_API_KEY is not set/i,
    /Enter your Google AI API key/i,
  ],
  openrouter: [
    /OPENROUTER_API_KEY is not set/i,
    /Enter your OpenRouter API key/i,
  ],
};

/**
 * Per-pane state: which provider's CLI is running here, plus a rolling
 * buffer of recent stdout so a prompt that arrives split across chunks
 * still matches.
 */
interface PaneState {
  provider: ProviderId;
  /** Recent stdout content, capped to BUFFER_MAX chars. */
  buffer: string;
  /** Once we've fired a prompt event for this pane, suppress duplicates
   *  until the user submits (or we time out / pane closes). */
  promptFired: boolean;
}

const BUFFER_MAX = 4096; // 4 KB rolling window — enough for any one prompt line + ANSI noise

/**
 * Listens to PTY stdout and fires `key-prompt` events when a known auth
 * prompt is detected for a registered pane. Other components register a
 * pane via `attach(paneId, provider)` after spawning the PTY; the
 * registry's `data` event then feeds bytes via `feed(paneId, data)`.
 *
 * Stateless across CLI versions in the sense that the regex map is the
 * only piece that needs updating when a CLI's prompt copy changes.
 */
export class PtyKeyInterceptor extends EventEmitter {
  private panes = new Map<string, PaneState>();

  /** Begin watching `paneId` for `provider`'s auth-prompt patterns. */
  attach(paneId: string, provider: ProviderId): void {
    this.panes.set(paneId, { provider, buffer: '', promptFired: false });
  }

  /** Stop watching `paneId`. Called on pane close or successful auth. */
  detach(paneId: string): void {
    this.panes.delete(paneId);
  }

  /** Mark the prompt as resolved (user submitted a key). Re-enables matching
   *  in case the CLI prompts again later (e.g. wrong key entered). */
  resetPromptState(paneId: string): void {
    const state = this.panes.get(paneId);
    if (!state) return;
    state.buffer = '';
    state.promptFired = false;
  }

  /** Feed a chunk of stdout. Strips ANSI control sequences for matching only
   *  (the raw chunk still goes to the renderer untouched via the normal
   *  data event in pty-registry). */
  feed(paneId: string, data: string): void {
    const state = this.panes.get(paneId);
    if (!state || state.promptFired) return;

    // Append + cap. We keep a tail window because a prompt line may straddle
    // multiple write chunks.
    const cleaned = stripAnsi(data);
    state.buffer = (state.buffer + cleaned).slice(-BUFFER_MAX);

    const patterns = PROMPT_PATTERNS[state.provider];
    if (!patterns) return;
    for (const re of patterns) {
      if (re.test(state.buffer)) {
        state.promptFired = true;
        this.emit('key-prompt', { paneId, provider: state.provider });
        return;
      }
    }
  }

  /** Test-helper: returns the current rolling buffer for a pane. Not used in
   *  prod paths; exposed for unit tests if/when we add them. */
  bufferFor(paneId: string): string {
    return this.panes.get(paneId)?.buffer ?? '';
  }
}

/**
 * Minimal ANSI escape-sequence stripper. Removes CSI / OSC / ESC sequences
 * commonly emitted by interactive CLIs so the regex match can focus on the
 * visible prompt text. Does not perfectly reverse all ANSI — good enough
 * for substring detection on prompt copy.
 */
function stripAnsi(s: string): string {
  // CSI (e.g. \x1b[31m), OSC (e.g. \x1b]0;title\x07), and bare ESC chars.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}
