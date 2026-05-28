/**
 * Line-delimited JSON stream parser for chat-mode profiles.
 *
 * Claude CLI in `--output-format=stream-json` mode emits one JSON value
 * per line (newline-delimited / JSONL). Network PTY chunks split lines
 * mid-byte, so this parser buffers a partial-line tail across `feed()`
 * calls. Each complete line gets JSON.parse'd; failures are surfaced as
 * `parse-error` events rather than thrown — chat UIs need to keep
 * rendering even when the CLI emits stray non-JSON noise (banners,
 * warnings, stderr leaking through, etc.).
 *
 * Design choices:
 *   - **Forgiving over strict.** We never throw. A bad line returns a
 *     `parse-error` event the caller can render as raw text or skip.
 *   - **No size limit on the partial-line buffer.** Pathological input
 *     (a CLI that streams 1 GB without a newline) would balloon the
 *     buffer; in practice Claude emits one event per line of ~1-5 KB.
 *     A bounded buffer is a follow-up if this turns into a real issue.
 *   - **`\r\n` is tolerated** by trimming each split line before parse;
 *     same behavior as JSONL on Windows.
 *   - **Stateless except for the partial-line tail.** Caller owns the
 *     event log; the parser just produces events.
 *
 * Separate from `interpretClaudeChatEvent` below — parsing is generic;
 * the interpreter is Claude-specific so future profiles (gemini-chat?
 * gpt-chat?) can reuse the parser and write their own interpreter.
 */

export type JsonStreamEvent =
  | { kind: 'json'; value: unknown; raw: string }
  | { kind: 'parse-error'; raw: string; error: string };

export class JsonStreamParser {
  private buffer = '';

  /** Push the next chunk of bytes from the PTY. Returns zero or more
   *  events for the lines that completed in this chunk. */
  feed(chunk: string): JsonStreamEvent[] {
    if (!chunk) return [];
    this.buffer += chunk;
    const out: JsonStreamEvent[] = [];
    // Split on \n; the last segment may be incomplete and stays in the
    // buffer. `\r\n` is handled by trimming individual lines before parse.
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const line = rawLine.replace(/\r+$/, '').trim();
      if (!line) continue;
      try {
        const value = JSON.parse(line);
        out.push({ kind: 'json', value, raw: line });
      } catch (e) {
        out.push({
          kind: 'parse-error',
          raw: line,
          error: (e as Error).message ?? 'parse failed',
        });
      }
    }
    return out;
  }

  /** Force-emit whatever's in the buffer as one final event. Useful
   *  when the PTY exits and the last line lacks a terminating newline. */
  flush(): JsonStreamEvent[] {
    if (!this.buffer.trim()) {
      this.buffer = '';
      return [];
    }
    const line = this.buffer.replace(/\r+$/, '').trim();
    this.buffer = '';
    try {
      return [{ kind: 'json', value: JSON.parse(line), raw: line }];
    } catch (e) {
      return [{
        kind: 'parse-error',
        raw: line,
        error: (e as Error).message ?? 'parse failed',
      }];
    }
  }
}

// --- Claude chat-mode event interpreter -------------------------------------

/**
 * Action a parsed event maps to inside the chat-skin renderer.
 *
 * Block-aware design (PR #22): one event can produce multiple actions —
 * an assistant message with `[text, tool_use, text]` content blocks
 * emits three actions in order. The renderer's reducer applies each
 * action sequentially. Each non-text block becomes its own ChatMessage,
 * so the chat reads top-to-bottom as the user/assistant/tool exchange
 * actually happened.
 */
export type ClaudeChatAction =
  /** Append a chunk of text to the most recent assistant-text bubble.
   *  If the last bubble is NOT a plain assistant-text bubble (e.g.
   *  it's a tool_use card or a user bubble), start a new text bubble. */
  | { kind: 'append-assistant-text'; text: string }
  /** Replace the last assistant-text bubble outright. Used by `result`
   *  events that carry the consolidated final text. */
  | { kind: 'replace-last-assistant'; text: string }
  /** Add a tool_use card (compact "🔧 <name>" pill with expandable input). */
  | { kind: 'add-tool-use'; toolUseId: string; name: string; input: unknown }
  /** Add a tool_result card (collapsible output, matched by tool_use_id). */
  | { kind: 'add-tool-result'; toolUseId: string; output: string }
  /** Add a thinking block (Claude extended reasoning, italic + muted). */
  | { kind: 'add-thinking'; text: string }
  /** User message echoed back from the CLI; dedup against optimistic render. */
  | { kind: 'new-user-message'; text: string }
  | { kind: 'system'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'ignore'; reason: string };

/**
 * Map a raw JSON event from the Claude CLI to zero-or-more
 * chat-renderer actions. Returns an array so events with multiple
 * content blocks (e.g., assistant message with text + tool_use + text)
 * can fan out into multiple visual messages in stream order.
 *
 * Recognized event shapes (loose, version-tolerant):
 *
 *   { type: 'system', subtype: 'init', ... }                     → system note
 *   { type: 'user', message: { role, content: [text|tool_result, ...] } }
 *                                                                  → echo + tool results
 *   { type: 'assistant', message: { role, content: [text|tool_use|thinking, ...] } }
 *                                                                  → text bubbles + tool cards + thinking
 *   { type: 'result', subtype: 'success', result: '...', is_error }
 *                                                                  → final text or error bubble
 *   { type: 'content_block_delta', delta: { type: 'text_delta', text } }
 *                                                                  → streaming text delta
 *
 * Unknown shapes return a single `ignore` action — caller can stash
 * them in a debug pane if it wants.
 */
export function interpretClaudeChatEvent(value: unknown): ClaudeChatAction[] {
  if (!value || typeof value !== 'object') {
    return [{ kind: 'ignore', reason: 'non-object event' }];
  }
  const ev = value as Record<string, unknown>;
  const type = typeof ev.type === 'string' ? ev.type : null;

  // Streaming text deltas (Anthropic Messages API style). One delta = one append.
  if (type === 'content_block_delta' && ev.delta && typeof ev.delta === 'object') {
    const d = ev.delta as Record<string, unknown>;
    if (d.type === 'text_delta' && typeof d.text === 'string') {
      return [{ kind: 'append-assistant-text', text: d.text }];
    }
    return [{ kind: 'ignore', reason: `content_block_delta type=${String(d.type)}` }];
  }

  // Assistant message — iterate content blocks, emit one action per block.
  if (type === 'assistant' && ev.message && typeof ev.message === 'object') {
    return contentBlocksToActions(
      (ev.message as Record<string, unknown>).content,
      'assistant'
    );
  }

  // User message — same iteration. User messages can include tool_result
  // blocks (that's how the Messages API threads tool outputs back to the model).
  if (type === 'user' && ev.message && typeof ev.message === 'object') {
    return contentBlocksToActions(
      (ev.message as Record<string, unknown>).content,
      'user'
    );
  }

  // Final result — replace last assistant-text bubble with the consolidated
  // text. Errors become error bubbles.
  if (type === 'result') {
    const isError = ev.is_error === true;
    const text =
      typeof ev.result === 'string'
        ? ev.result
        : typeof ev.error === 'string'
        ? (ev.error as string)
        : '';
    if (isError) {
      return [{ kind: 'error', text: text || 'Claude reported an error.' }];
    }
    if (text) return [{ kind: 'replace-last-assistant', text }];
    return [{ kind: 'ignore', reason: 'result with no text payload' }];
  }

  if (type === 'system') {
    const subtype = typeof ev.subtype === 'string' ? ev.subtype : 'system';
    if (subtype === 'init') {
      return [{ kind: 'system', text: 'Claude JSON session ready.' }];
    }
    return [{ kind: 'ignore', reason: `system subtype=${subtype}` }];
  }

  if (type === 'error') {
    const msg =
      typeof ev.error === 'string'
        ? (ev.error as string)
        : typeof ev.message === 'string'
        ? (ev.message as string)
        : 'Unknown error';
    return [{ kind: 'error', text: msg }];
  }

  return [{ kind: 'ignore', reason: `unknown type=${type ?? '(missing)'}` }];
}

/**
 * Walk an Anthropic-style content array and emit one action per block.
 * Blocks we recognize: `text`, `tool_use`, `tool_result`, `thinking`.
 * Unknown block types become `ignore` actions.
 */
function contentBlocksToActions(
  content: unknown,
  role: 'assistant' | 'user'
): ClaudeChatAction[] {
  if (!Array.isArray(content)) {
    return [{ kind: 'ignore', reason: `${role} message with non-array content` }];
  }
  const out: ClaudeChatAction[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    const btype = typeof b.type === 'string' ? b.type : null;

    if (btype === 'text' && typeof b.text === 'string') {
      if (role === 'assistant') {
        // Use append-assistant-text rather than replace; the renderer's
        // applyClaudeAction starts a new text bubble whenever the
        // previous message isn't a plain assistant-text bubble (i.e.
        // tool_use cards interrupt the run), so mixed [text, tool, text]
        // produces three visual messages in stream order.
        out.push({ kind: 'append-assistant-text', text: b.text });
      } else {
        out.push({ kind: 'new-user-message', text: b.text });
      }
      continue;
    }

    if (btype === 'tool_use') {
      const id = typeof b.id === 'string' ? b.id : `tu_${Math.random().toString(36).slice(2, 10)}`;
      const name = typeof b.name === 'string' ? b.name : 'tool';
      out.push({ kind: 'add-tool-use', toolUseId: id, name, input: b.input });
      continue;
    }

    if (btype === 'tool_result') {
      const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
      out.push({
        kind: 'add-tool-result',
        toolUseId,
        output: extractToolResultText(b.content),
      });
      continue;
    }

    if (btype === 'thinking' && typeof b.thinking === 'string') {
      out.push({ kind: 'add-thinking', text: b.thinking });
      continue;
    }

    out.push({ kind: 'ignore', reason: `${role} block type=${btype ?? '(missing)'}` });
  }
  if (out.length === 0) {
    return [{ kind: 'ignore', reason: `${role} message with no recognizable blocks` }];
  }
  return out;
}

/**
 * Tool-result content per the Anthropic Messages API can be a string
 * OR an array of content blocks (each a {type:'text',text} or image).
 * We flatten to a single string for display; images get a placeholder
 * that surfaces media_type + source kind so the user knows roughly
 * what was returned (e.g., `[image: image/png, base64, ~24 KB]`).
 */
function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text);
    } else if (b.type === 'image') {
      parts.push(formatImagePlaceholder(b));
    }
  }
  return parts.join('\n');
}

/**
 * Build a one-line placeholder for an Anthropic image content block.
 * Prefers media_type + source kind (`base64` / `url`); for URL sources,
 * shows a truncated URL so the user can recognize it. Used until the
 * chat skin grows real image rendering (CSP review required).
 */
function formatImagePlaceholder(block: Record<string, unknown>): string {
  const source = block.source;
  if (!source || typeof source !== 'object') return '[image]';
  const s = source as Record<string, unknown>;
  const media = typeof s.media_type === 'string' ? s.media_type : 'image';
  const kind = typeof s.type === 'string' ? s.type : 'unknown';
  if (kind === 'url' && typeof s.url === 'string') {
    const truncated = s.url.length > 60 ? s.url.slice(0, 57) + '…' : s.url;
    return `[image: ${media}, url=${truncated}]`;
  }
  if (kind === 'base64' && typeof s.data === 'string') {
    // base64 inflation: bytes ≈ length * 3 / 4. KB approx for legibility.
    const approxBytes = Math.floor((s.data.length * 3) / 4);
    const approxKb = (approxBytes / 1024).toFixed(approxBytes >= 102400 ? 0 : 1);
    return `[image: ${media}, base64, ~${approxKb} KB]`;
  }
  return `[image: ${media}, ${kind}]`;
}

// --- User-input encoder -----------------------------------------------------

/**
 * Wrap a user's plain-text message as a JSON event the Claude CLI
 * expects on stdin in `--input-format=stream-json` mode. Mirrors the
 * Anthropic Messages API user-message shape.
 *
 * Returns the JSON string WITH a trailing newline (JSONL framing) so
 * the caller can pipe directly to `terminal.sendInput`.
 */
export function encodeUserMessageJsonl(text: string): string {
  const payload = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  };
  return JSON.stringify(payload) + '\n';
}
