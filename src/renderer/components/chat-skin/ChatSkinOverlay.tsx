import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  JsonStreamParser,
  interpretClaudeChatEvent,
  encodeUserMessageJsonl,
} from './json-stream-parser';

/** Profiles that should be rendered via the JSONL stream path instead
 *  of the default "sanitize the TUI bytes" path. Single-element set
 *  today; future profiles (gemini-chat, gpt-chat, ...) can be added
 *  here without touching the rendering branches. */
const JSON_STREAM_PROFILES = new Set<string>(['api.anthropic.claude-chat']);

function isJsonStreamProfile(profile: string | undefined): boolean {
  return !!profile && JSON_STREAM_PROFILES.has(profile);
}

/**
 * Chat-skin overlay v2 — clean modern chat UI over the terminal pane.
 *
 * Design source: pattern-matched from multiple modern AI chats (Vercel
 * AI Chatbot, shadcn chat blocks, Pi.ai, Cursor, the Character.AI
 * reference the user shared). Intentionally NOT a copy of any one of
 * them — picks the common-denominator elements:
 *   - Persona header at top with a model badge + subtitle.
 *   - Centered narrow column (~720px) with generous whitespace.
 *   - Soft rounded bubbles for BOTH roles (no per-message avatars).
 *     User bubbles get a slight accent tint to distinguish.
 *   - Markdown rendering with syntax-highlighted code blocks.
 *   - Pill-shaped composer with a circular send button on the right.
 *   - Streaming caret on the latest assistant message.
 *   - 4-card empty state with suggested prompts.
 *
 * The skin sits on top of the same PTY the xterm uses; toggling off
 * reveals the terminal underneath with full scrollback intact.
 *
 * Echo + ANSI handling:
 *   - Strip CSI / OSC / cursor-movement escapes from incoming bytes
 *     for matching display only (the xterm gets raw bytes untouched).
 *   - Suppress the first chunk's leading-substring echo of what the
 *     user just sent (CLI input-echo from cooked-mode terminals).
 *   - Strip carriage-returns that the terminal would interpret as
 *     cursor-to-start-of-line; chat UI just wants newlines.
 */

/**
 * One unit of the chat timeline. Most messages carry plain `text`. Tool
 * blocks (chat-mode only) attach via the discriminator fields below — a
 * tool_use card has `toolUse` set, a tool_result has `toolResult` set,
 * a thinking block has `thinking` set. The renderer dispatches on
 * whichever is present (text falls through as the default).
 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  toolUse?: { id: string; name: string; input: unknown };
  toolResult?: { toolUseId: string; output: string };
  thinking?: string;
}

/** True when the message is a plain text bubble — used by the JSON
 *  reducer to decide whether a delta should append to the current
 *  bubble or start a new one (tool/thinking interrupt the run). */
function isPlainTextMessage(m: ChatMessage | undefined): boolean {
  return !!m && !m.toolUse && !m.toolResult && !m.thinking;
}

interface Props {
  paneId: string;
  visible: boolean;
  onToggleOff: () => void;
  /** Catalog profile id of the tab this overlay sits on. When the profile
   *  is in `JSON_STREAM_PROFILES`, the overlay parses incoming bytes as
   *  newline-delimited JSON events (Claude's `stream-json` mode) and
   *  wraps outgoing user input as JSON events on send. Undefined defaults
   *  to the text-mode path used by the regular Claude CLI / model REPLs. */
  profile?: string;
}

const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 100_000;
const ECHO_SUPPRESS_WINDOW_MS = 1500;
const STREAMING_TAIL_MS = 800;

const SUGGESTIONS: Array<{ title: string; subtitle: string; prompt: string }> = [
  {
    title: 'Tour the codebase',
    subtitle: 'High-level walkthrough',
    prompt: 'Give me a tour of this repo. Start with the directory structure.',
  },
  {
    title: 'Debug an error',
    subtitle: 'Paste a stack trace',
    prompt: 'I hit this error:\n\n```\n```\n\nWhat\'s wrong?',
  },
  {
    title: 'Refactor something',
    subtitle: 'Improve existing code',
    prompt: 'Refactor ',
  },
  {
    title: 'Explain a concept',
    subtitle: 'TL;DR or deep dive',
    prompt: 'Explain ',
  },
];

const FONT_STACK =
  '"Söhne", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_STACK =
  '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", monospace';

export function ChatSkinOverlay({ paneId, visible, onToggleOff, profile }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [lastChunkAt, setLastChunkAt] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef<{ text: string; at: number } | null>(null);
  // JSON-stream parser instance per paneId. Re-created when paneId
  // changes; persists across PTY chunks within the same pane.
  const parserRef = useRef<JsonStreamParser | null>(null);
  const jsonMode = isJsonStreamProfile(profile);

  useEffect(() => {
    if (jsonMode) {
      parserRef.current = new JsonStreamParser();
    } else {
      parserRef.current = null;
    }
    const unsub = window.electronAPI.terminal.onData(paneId, (data) => {
      if (jsonMode) {
        ingestJsonChunk(data);
      } else {
        appendAssistantChunk(data);
      }
    });
    return () => {
      try {
        unsub();
      } catch {
        // ignore
      }
      parserRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, jsonMode]);

  const appendAssistantChunk = useCallback((rawData: string) => {
    // Decide BEFORE sanitizing whether this chunk contains a screen-clear
    // / alt-screen-enter sequence. When Claude (or any TUI) repaints, our
    // sanitizer would silently merge the new paint with the old text — the
    // user sees the same content "doubled up." Detecting the reset in the
    // RAW bytes (before stripping) lets us start a fresh assistant message.
    const startsNewPaint = /\x1b\[2J|\x1bc|\x1b\[\?1049[hl]|\x1b\[H/.test(rawData);

    let cleaned = sanitizeForChat(rawData);
    if (!cleaned) return;

    const last = lastSentRef.current;
    if (last && Date.now() - last.at < ECHO_SUPPRESS_WINDOW_MS) {
      const trimmedCleaned = cleaned.trimStart();
      if (trimmedCleaned.startsWith(last.text)) {
        cleaned = trimmedCleaned.slice(last.text.length).replace(/^[\r\n]+/, '');
      }
      lastSentRef.current = null;
    }
    if (!cleaned) return;

    setLastChunkAt(Date.now());
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      // If the CLI just cleared the screen, start a fresh assistant
      // message so the new paint doesn't visually duplicate the old one.
      if (lastMsg && lastMsg.role === 'assistant' && !startsNewPaint) {
        const nextText = (lastMsg.text + cleaned).slice(0, MAX_MESSAGE_CHARS);
        // Also drop the previous message if the new full text starts with
        // it — that's the "redraw of the same content" case.
        if (lastMsg.text && cleaned.includes(lastMsg.text.trim().slice(0, 80))) {
          // Just replace with the new content instead of doubling.
          return [
            ...prev.slice(0, -1),
            { ...lastMsg, text: cleaned.slice(0, MAX_MESSAGE_CHARS) },
          ];
        }
        return [...prev.slice(0, -1), { ...lastMsg, text: nextText }];
      }
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: cleaned.slice(0, MAX_MESSAGE_CHARS),
          timestamp: Date.now(),
        },
      ]);
    });
  }, []);

  /**
   * Stream-JSON ingest path. Feeds each chunk into the line-buffered
   * parser, then maps each emitted event to a chat-message update via
   * `interpretClaudeChatEvent`. Mirrors `appendAssistantChunk` for the
   * text-mode path but skips echo-suppression entirely (the CLI in
   * non-interactive mode doesn't echo the user's stdin back as text).
   */
  const ingestJsonChunk = useCallback((rawData: string) => {
    const parser = parserRef.current;
    if (!parser) return;
    const events = parser.feed(rawData);
    if (events.length === 0) return;
    setLastChunkAt(Date.now());
    setMessages((prev) => {
      let next = prev;
      for (const ev of events) {
        if (ev.kind === 'parse-error') {
          // Surface non-JSON noise (banners, stderr leaks) as a small
          // system note rather than dropping silently. Keeps the user
          // informed if Claude's CLI starts emitting unexpected output.
          next = cap([
            ...next,
            {
              id: makeId(),
              role: 'assistant',
              text: `_(non-JSON line: ${ev.raw.slice(0, 200)}${ev.raw.length > 200 ? '…' : ''})_`,
              timestamp: Date.now(),
            },
          ]);
          continue;
        }
        // Interpreter now returns an action array — one event can fan
        // out into multiple visual messages when a content_block array
        // contains text + tool_use + text etc.
        const actions = interpretClaudeChatEvent(ev.value);
        for (const action of actions) {
          next = applyClaudeAction(next, action);
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, visible]);

  const send = useCallback(
    (textOverride?: string) => {
      const text = (textOverride ?? draft).trim();
      if (!text) return;
      setMessages((prev) =>
        cap([
          ...prev,
          { id: makeId(), role: 'user', text, timestamp: Date.now() },
        ])
      );
      // Echo-suppression is text-mode only; the JSON path never sees a
      // stdin echo back through stdout (the CLI is non-interactive).
      lastSentRef.current = jsonMode ? null : { text, at: Date.now() };
      try {
        // In JSON-stream mode, wrap as a Claude SDK user-message event
        // with a trailing newline (JSONL framing). In text mode, send
        // raw text + CR like an interactive TTY would.
        const payload = jsonMode ? encodeUserMessageJsonl(text) : text + '\r';
        window.electronAPI.terminal.sendInput(paneId, payload);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(),
            role: 'assistant',
            text: '⚠ Could not deliver to the terminal (PTY unavailable).',
            timestamp: Date.now(),
          },
        ]);
      }
      setDraft('');
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = '24px';
          el.focus();
        }
      });
    },
    [draft, paneId, jsonMode]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /**
   * Stop the in-flight generation by sending an SIGINT char (\x03) to
   * the PTY. This is the same byte Ctrl+C sends in a real terminal and
   * is the conventional way to abort a CLI process. For Claude in
   * non-interactive `--print --output-format=stream-json` mode the
   * binary should treat this as "cancel current response, keep the
   * session alive" — but the exact semantics are version-dependent
   * (older Claude builds may exit the whole session). Pending a real
   * binary probe; we'll iterate if Claude has a structured abort
   * event instead.
   */
  const stopGeneration = useCallback(() => {
    if (!jsonMode) return;
    try {
      window.electronAPI.terminal.sendInput(paneId, '\x03');
    } catch {
      // PTY may be dead — nothing to abort. No-op.
    }
  }, [jsonMode, paneId]);

  // Schedule a single re-render once the streaming window passes, so the
  // Stop button flips back to Send the moment chunks stop arriving (a
  // setInterval with `setLastChunkAt(v => v)` would bail in React on
  // identical state — `streamingTick` is a fresh counter that doesn't).
  const [streamingTick, setStreamingTick] = useState(0);
  useEffect(() => {
    if (lastChunkAt === 0) return;
    const timer = window.setTimeout(() => {
      setStreamingTick((t) => t + 1);
    }, STREAMING_TAIL_MS + 50);
    return () => window.clearTimeout(timer);
  }, [lastChunkAt]);

  const isStreaming = useMemo(() => {
    if (lastChunkAt === 0) return false;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return false;
    return Date.now() - lastChunkAt < STREAMING_TAIL_MS;
    // streamingTick included so the memo re-evaluates after the timer
    // above fires — otherwise the Stop button would stay visible after
    // the actual stream finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, lastChunkAt, streamingTick]);

  const personaLabel = useMemo(() => derivePersonaLabel(paneId), [paneId]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        fontFamily: FONT_STACK,
        color: 'var(--text-primary)',
      }}
    >
      <SkinHeader label={personaLabel} onToggleOff={onToggleOff} />

      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '20px 0 8px' }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '0 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {messages.length === 0 ? (
            <EmptyState
              label={personaLabel}
              onPickSuggestion={(p) => {
                setDraft(p);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
            />
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                showCursor={isStreaming && i === messages.length - 1}
              />
            ))
          )}
        </div>
      </div>

      <Composer
        textareaRef={textareaRef}
        draft={draft}
        setDraft={setDraft}
        onSend={() => send()}
        onKeyDown={handleKeyDown}
        placeholder={`Message ${personaLabel}…`}
        // Stop button only available in JSON chat-mode — text-mode
        // CLIs handle their own interrupts in the interactive TUI.
        canStop={jsonMode && isStreaming}
        onStop={stopGeneration}
      />

      <style>{`
        @keyframes ccs-chat-blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }
        .ccs-chat-caret {
          display: inline-block;
          width: 6px; height: 0.95em;
          margin-left: 2px;
          vertical-align: text-bottom;
          background: var(--accent);
          animation: ccs-chat-blink 1s steps(2) infinite;
        }
      `}</style>
    </div>
  );
}

// ----- Sub-components -----

function SkinHeader({ label, onToggleOff }: { label: string; onToggleOff: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 18px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-primary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PersonaAvatar size={26} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.005em',
            }}
          >
            {label}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            Same PTY underneath — toggle off to see raw terminal
          </span>
        </div>
      </div>
      <button
        onClick={onToggleOff}
        title="Show terminal view"
        style={{
          padding: '5px 12px',
          borderRadius: 999,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        Terminal
      </button>
    </div>
  );
}

function PersonaAvatar({ size = 32 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: 'var(--accent-gradient)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        flexShrink: 0,
        boxShadow: 'var(--shadow-glow, 0 0 16px rgba(124,58,237,0.25))',
      }}
    >
      <svg
        width={size * 0.5}
        height={size * 0.5}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2 L14 9 L21 11 L14 13 L12 20 L10 13 L3 11 L10 9 Z" />
      </svg>
    </div>
  );
}

function MessageBubble({ message, showCursor }: { message: ChatMessage; showCursor: boolean }) {
  // Dispatch on tool/thinking discriminators before falling through to
  // the plain text bubble path. Each renders as its own row in the
  // timeline so the visual order matches Claude's emit order.
  if (message.toolUse) return <ToolUseCard toolUse={message.toolUse} />;
  if (message.toolResult) return <ToolResultCard result={message.toolResult} />;
  if (message.thinking) return <ThinkingBlock text={message.thinking} />;

  const isUser = message.role === 'user';
  // Detect Claude/Codex/Aider-style interactive selection prompts. These
  // require keyboard-only responses (Enter / Esc / numeric pick) that the
  // chat skin's send-text path can't deliver cleanly. Surface a callout
  // pointing the user back to Terminal view rather than letting them
  // type something that won't work.
  const looksInteractive =
    !isUser && /(Enter to confirm|Esc to cancel|↵ to confirm|press enter|Select an option|❯\s*\d|\b\d\.\s.+\s\d\.\s)/i.test(
      message.text
    );
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {looksInteractive && <InteractivePromptBanner />}
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 18,
            background: isUser
              ? 'var(--accent-dim, rgba(124,58,237,0.16))'
              : 'rgba(255,255,255,0.04)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 15,
            lineHeight: 1.65,
            wordBreak: 'break-word',
          }}
        >
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
          ) : (
            <>
              <AssistantMarkdown text={message.text} />
              {showCursor && <span className="ccs-chat-caret" />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Tool-use / tool-result / thinking renderers (chat-mode profile) ----

/**
 * Compact card for a `tool_use` content block. Shows the tool name
 * and a one-line input preview by default; click to expand the full
 * JSON input. Pure presentation — actual tool execution happens in
 * the CLI, this is just visibility.
 */
function ToolUseCard({ toolUse }: { toolUse: NonNullable<ChatMessage['toolUse']> }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(toolUse.input);
  const shortId = shortToolId(toolUse.id);
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 12,
          background: 'rgba(124,58,237,0.08)',
          border: '1px solid rgba(124,58,237,0.25)',
          fontSize: 13,
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 0,
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'inherit',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 14 }} aria-hidden="true">🔧</span>
          <span style={{ fontWeight: 600 }}>{toolUse.name}</span>
          {shortId && (
            <span
              title={`tool_use_id: ${toolUse.id}`}
              style={{
                fontSize: 10,
                fontFamily: MONO_STACK,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'rgba(124,58,237,0.18)',
                color: 'var(--accent-light)',
                flexShrink: 0,
              }}
            >
              #{shortId}
            </span>
          )}
          {!open && summary && (
            <span
              style={{
                color: 'var(--text-secondary)',
                fontFamily: MONO_STACK,
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                flex: 1,
              }}
            >
              {summary}
            </span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--text-secondary)',
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 120ms',
            }}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        {open && (
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              background: '#0a0a14',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.4,
              fontFamily: MONO_STACK,
              color: 'var(--text-primary)',
              overflow: 'auto',
              maxHeight: 240,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {safeStringify(toolUse.input)}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Compact card for a `tool_result` content block. Collapsed by default
 * since outputs are often long (file contents, command output). Click
 * to expand. The matching tool_use_id is shown so the user can correlate
 * even when results arrive out of order.
 */
function ToolResultCard({ result }: { result: NonNullable<ChatMessage['toolResult']> }) {
  const [open, setOpen] = useState(false);
  const lineCount = result.output ? result.output.split('\n').length : 0;
  const preview = result.output ? result.output.replace(/\n/g, ' ').slice(0, 80) : '(empty)';
  const shortId = shortToolId(result.toolUseId);
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 12,
          background: 'rgba(74,222,128,0.06)',
          border: '1px solid rgba(74,222,128,0.22)',
          fontSize: 13,
          color: 'var(--text-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 0,
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'inherit',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 14 }} aria-hidden="true">↩</span>
          <span style={{ fontWeight: 600 }}>Tool result</span>
          {shortId && (
            <span
              title={`tool_use_id: ${result.toolUseId}`}
              style={{
                fontSize: 10,
                fontFamily: MONO_STACK,
                padding: '1px 6px',
                borderRadius: 999,
                background: 'rgba(74,222,128,0.18)',
                color: '#86efac',
                flexShrink: 0,
              }}
            >
              #{shortId}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
          </span>
          {!open && (
            <span
              style={{
                color: 'var(--text-secondary)',
                fontFamily: MONO_STACK,
                fontSize: 11,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                flex: 1,
              }}
            >
              {preview}
            </span>
          )}
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: 'var(--text-secondary)',
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 120ms',
            }}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        {open && (
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              background: '#0a0a14',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.4,
              fontFamily: MONO_STACK,
              color: 'var(--text-primary)',
              overflow: 'auto',
              maxHeight: 320,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {result.output || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * Inline display for Claude's extended-reasoning `thinking` blocks.
 * Muted + italic by default so it doesn't compete with the actual
 * response. Click-to-expand for the full reasoning text.
 */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lineCount = text.split('\n').length;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div
        style={{
          maxWidth: '85%',
          padding: '8px 12px',
          borderRadius: 12,
          background: 'rgba(148,163,184,0.06)',
          border: '1px dashed rgba(148,163,184,0.30)',
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 0,
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'inherit',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textAlign: 'left',
          }}
        >
          <span aria-hidden="true">💭</span>
          <span style={{ fontWeight: 600, fontStyle: 'normal' }}>Thinking</span>
          <span style={{ fontStyle: 'normal', fontSize: 11 }}>
            ({lineCount} {lineCount === 1 ? 'line' : 'lines'})
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              transform: open ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 120ms',
              fontStyle: 'normal',
            }}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        {open && (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{text}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Priority-ordered list of input field names to surface as the
 * tool's one-line summary. Expanded in PR #26: catches Read/Write/Edit
 * (`file_path`), Bash (`command`), Grep (`pattern`/`query`), Glob
 * (`pattern`), web tools (`url`), task launchers (`prompt`/
 * `description`), and Anthropic SDK conventions
 * (`target_file`, `cmd`, `q`, `instruction`, `text`, `content`). New
 * tool definitions can drop in at the end without reshuffling.
 */
const TOOL_SUMMARY_FIELDS = [
  'file_path', 'path', 'filename', 'target_file',
  'command', 'cmd', 'shell', 'script',
  'query', 'pattern', 'q', 'search',
  'prompt', 'instruction', 'description',
  'url', 'href',
  'text', 'content',
];

function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  for (const key of TOOL_SUMMARY_FIELDS) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) {
      return v.length > 80 ? v.slice(0, 79) + '…' : v;
    }
  }
  const keys = Object.keys(obj).slice(0, 3).join(', ');
  return keys ? `{ ${keys} }` : '';
}

/**
 * Compact identifier shown on both ToolUseCard and ToolResultCard so
 * the user can correlate a result with its originating call. Strips
 * the Anthropic SDK `toolu_` / `tu_` prefix and shows the first 6
 * chars of the remainder — enough to be unique within a session,
 * short enough to fit beside the icon.
 */
function shortToolId(id: string): string {
  if (!id) return '';
  const cleaned = id.replace(/^toolu?_/, '');
  return cleaned.slice(0, 6);
}

/**
 * Collapse whitespace runs to single spaces + trim. Used for the
 * user-message echo dedup so Claude's text normalization (`\n\n\n` →
 * `\n\n`, trailing-space removal, etc.) doesn't trip the equality
 * check and double-render the message.
 */
function normalizeForDedup(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function InteractivePromptBanner() {
  return (
    <div
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        background: 'rgba(251, 191, 36, 0.10)',
        border: '1px solid rgba(251, 191, 36, 0.35)',
        fontSize: 12,
        lineHeight: 1.5,
        color: '#fcd34d',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
      }}
    >
      <span aria-hidden="true">⚠</span>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>
          The CLI is waiting for an interactive choice
        </div>
        <div style={{ color: 'rgba(252,211,77,0.85)' }}>
          Selection menus need keyboard-only responses (Enter / Esc / arrow keys / number picks).
          Click "Terminal" in the header to respond, then come back here.
        </div>
      </div>
    </div>
  );
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: CodeRenderer,
        p: ({ children }) => <p style={{ margin: '0 0 10px' }}>{children}</p>,
        ul: ({ children }) => (
          <ul style={{ margin: '0 0 10px', paddingLeft: 22 }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: '0 0 10px', paddingLeft: 22 }}>{children}</ol>
        ),
        li: ({ children }) => <li style={{ marginBottom: 3 }}>{children}</li>,
        h1: ({ children }) => <h2 style={mdHeadingStyle(20)}>{children}</h2>,
        h2: ({ children }) => <h3 style={mdHeadingStyle(17)}>{children}</h3>,
        h3: ({ children }) => <h4 style={mdHeadingStyle(15)}>{children}</h4>,
        a: ({ children, href }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (typeof href === 'string') {
                void window.electronAPI.models
                  .openExternal(href)
                  .catch(() => undefined);
              }
            }}
            style={{
              color: 'var(--accent-light)',
              textDecoration: 'underline',
            }}
          >
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote
            style={{
              margin: '0 0 10px',
              padding: '4px 12px',
              borderLeft: '2px solid var(--border-active)',
              color: 'var(--text-secondary)',
            }}
          >
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div style={{ overflowX: 'auto', margin: '0 0 10px' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th
            style={{
              border: '1px solid var(--border)',
              padding: '6px 10px',
              textAlign: 'left',
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td style={{ border: '1px solid var(--border)', padding: '6px 10px' }}>
            {children}
          </td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function mdHeadingStyle(size: number): React.CSSProperties {
  return {
    margin: '14px 0 8px',
    fontSize: size,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: 'var(--text-primary)',
  };
}

function CodeRenderer({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  className?: string;
  children?: React.ReactNode;
}) {
  const raw = String(children ?? '');
  const isBlock = raw.includes('\n') || /language-/.test(className ?? '');
  if (!isBlock) {
    return (
      <code
        style={{
          background: 'rgba(255,255,255,0.08)',
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: '0.875em',
          fontFamily: MONO_STACK,
        }}
        {...rest}
      >
        {children}
      </code>
    );
  }
  const lang = /language-(\w+)/.exec(className ?? '')?.[1] || 'text';
  const codeText = raw.replace(/\n$/, '');
  return (
    <div
      style={{
        background: '#0a0a14',
        border: '1px solid var(--border)',
        borderRadius: 10,
        margin: '10px 0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ fontFamily: FONT_STACK }}>{lang}</span>
        <button
          onClick={() => {
            void navigator.clipboard
              .writeText(codeText)
              .catch(() => undefined);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 11,
            padding: 0,
            fontFamily: FONT_STACK,
          }}
        >
          Copy
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          background: 'transparent',
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: MONO_STACK,
        }}
        PreTag="div"
      >
        {codeText}
      </SyntaxHighlighter>
    </div>
  );
}

function EmptyState({
  label,
  onPickSuggestion,
}: {
  label: string;
  onPickSuggestion: (prompt: string) => void;
}) {
  return (
    <div
      style={{
        margin: 'auto',
        maxWidth: 560,
        textAlign: 'center',
        padding: '40px 8px 0',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <PersonaAvatar size={48} />
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: 'var(--text-primary)',
          marginBottom: 6,
        }}
      >
        Chat with {label}
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 28,
          lineHeight: 1.5,
        }}
      >
        Same CLI underneath. Toggle off any time to see the raw terminal.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          textAlign: 'left',
        }}
      >
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            onClick={() => onPickSuggestion(s.prompt)}
            style={{
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              cursor: 'pointer',
              transition: 'all 150ms',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500 }}>{s.title}</div>
            <div
              style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}
            >
              {s.subtitle}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({
  textareaRef,
  draft,
  setDraft,
  onSend,
  onKeyDown,
  placeholder,
  canStop,
  onStop,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  /** Render Stop pill instead of Send while a JSON-mode response streams. */
  canStop?: boolean;
  onStop?: () => void;
}) {
  const hasContent = draft.trim().length > 0;
  const showStop = !!canStop && !!onStop;
  return (
    <div style={{ padding: '0 20px 18px', background: 'transparent' }}>
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          // Pill shape: large radius so single-line inputs look round; the
          // border-radius doesn't change as the textarea grows, but the
          // visual stays soft-rounded.
          borderRadius: 24,
          padding: '8px 8px 8px 18px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        }}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 15,
            lineHeight: 1.5,
            fontFamily: 'inherit',
            resize: 'none',
            minHeight: 24,
            maxHeight: 200,
            padding: '6px 0',
            overflowY: 'auto',
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = '24px';
            el.style.height = Math.min(200, el.scrollHeight) + 'px';
          }}
        />
        {showStop ? (
          <button
            onClick={onStop}
            title="Stop generation"
            aria-label="Stop generation"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(248,113,113,0.18)',
              color: '#fca5a5',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 120ms, background 120ms',
              flexShrink: 0,
              boxShadow: '0 0 12px rgba(248,113,113,0.25)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(248,113,113,0.28)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(248,113,113,0.18)';
              e.currentTarget.style.transform = '';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.92)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = '';
            }}
          >
            {/* Solid square — universal "stop" affordance. */}
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!hasContent}
            title="Send (Enter)"
            aria-label="Send"
            style={{
              // Perfectly round send button — matches the pill composer's
              // visual language. 32×32 = roomy enough for the arrow icon
              // without crowding adjacent input text.
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: 'none',
              background: hasContent
                ? 'var(--accent-gradient)'
                : 'rgba(255,255,255,0.08)',
              color: hasContent ? '#fff' : 'var(--text-secondary)',
              cursor: hasContent ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 120ms, background 120ms',
              flexShrink: 0,
              boxShadow: hasContent
                ? 'var(--shadow-glow, 0 0 16px rgba(124,58,237,0.35))'
                : 'none',
            }}
            onMouseDown={(e) => {
              if (hasContent) e.currentTarget.style.transform = 'scale(0.92)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = '';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = '';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ----- Helpers -----

function derivePersonaLabel(paneId: string): string {
  if (paneId === 'p_root' || paneId.startsWith('p_')) return 'Claude';
  if (paneId.startsWith('model:')) {
    const rest = paneId.slice(6);
    const dash = rest.lastIndexOf('-');
    const id = dash > 0 ? rest.slice(0, dash) : rest;
    // Replace underscores + dashes with spaces, title-case-ish.
    return id
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }
  return paneId;
}

function makeId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cap(arr: ChatMessage[]): ChatMessage[] {
  return arr.length > MAX_MESSAGES
    ? arr.slice(arr.length - MAX_MESSAGES)
    : arr;
}

/**
 * Apply one chat-renderer action (from interpretClaudeChatEvent) to
 * the message list. Pure: returns the new array, never mutates `prev`.
 * Lives at module scope so React's `setMessages` updater can call it
 * deterministically without depending on component closures.
 */
function applyClaudeAction(
  prev: ChatMessage[],
  action: import('./json-stream-parser').ClaudeChatAction
): ChatMessage[] {
  switch (action.kind) {
    case 'append-assistant-text': {
      const last = prev[prev.length - 1];
      // Only append when the last message is a *plain text* assistant
      // bubble. Tool cards / thinking blocks interrupt the text run, so
      // any text after them starts a fresh bubble — mirrors how the
      // stream actually reads top-to-bottom.
      if (last && last.role === 'assistant' && isPlainTextMessage(last)) {
        const nextText = (last.text + action.text).slice(0, MAX_MESSAGE_CHARS);
        return [...prev.slice(0, -1), { ...last, text: nextText }];
      }
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: action.text.slice(0, MAX_MESSAGE_CHARS),
          timestamp: Date.now(),
        },
      ]);
    }
    case 'replace-last-assistant': {
      const last = prev[prev.length - 1];
      const text = action.text.slice(0, MAX_MESSAGE_CHARS);
      if (last && last.role === 'assistant' && isPlainTextMessage(last)) {
        return [...prev.slice(0, -1), { ...last, text }];
      }
      return cap([
        ...prev,
        { id: makeId(), role: 'assistant', text, timestamp: Date.now() },
      ]);
    }
    case 'add-tool-use': {
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: '',
          timestamp: Date.now(),
          toolUse: {
            id: action.toolUseId,
            name: action.name,
            input: action.input,
          },
        },
      ]);
    }
    case 'add-tool-result': {
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'user',
          text: '',
          timestamp: Date.now(),
          toolResult: {
            toolUseId: action.toolUseId,
            output: action.output.slice(0, MAX_MESSAGE_CHARS),
          },
        },
      ]);
    }
    case 'add-thinking': {
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: '',
          timestamp: Date.now(),
          thinking: action.text.slice(0, MAX_MESSAGE_CHARS),
        },
      ]);
    }
    case 'new-user-message': {
      // Don't double-add: if the most recent user bubble already matches,
      // it's the optimistic render we added on send(). Compare on a
      // whitespace-normalized basis (PR #27, closes M-3 chat-mode) so
      // that Claude's internal text normalization — collapsing repeated
      // newlines or trimming trailing spaces — doesn't cause the same
      // message to appear twice.
      const recentUser = [...prev]
        .reverse()
        .find((m) => m.role === 'user' && isPlainTextMessage(m));
      if (
        recentUser &&
        normalizeForDedup(recentUser.text) === normalizeForDedup(action.text)
      ) {
        return prev;
      }
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'user',
          text: action.text.slice(0, MAX_MESSAGE_CHARS),
          timestamp: Date.now(),
        },
      ]);
    }
    case 'system': {
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: `_${action.text}_`,
          timestamp: Date.now(),
        },
      ]);
    }
    case 'error': {
      return cap([
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: `⚠ ${action.text}`,
          timestamp: Date.now(),
        },
      ]);
    }
    case 'ignore':
      return prev;
  }
}

/**
 * Aggressive sanitize for the chat-skin display path. Strips:
 *   - CSI sequences (`\x1b[…`),
 *   - OSC sequences (`\x1b]…\x07`),
 *   - DCS / SOS / PM / APC (`\x1b[PX^_]…\x1b\\`),
 *   - bare ESC bytes, BEL, NUL,
 *   - carriage-return-only lines (terminal uses them to overwrite a
 *     line in place; chat UI wants the final text only),
 *   - excess blank lines (3+ → 2).
 */
function sanitizeForChat(s: string): string {
  let out = s;
  // CSI / OSC / DCS / SOS / APC.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\x1b\][^\x07]*\x07/g, '');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\x1b[PX^_].*?\x1b\\/g, '');
  // Bare ESC, BEL, NUL.
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00\x07\x1b]/g, '');
  // Carriage-return-overwrite: split on \r and keep the last segment per
  // line (terminals use \rfoo\rbar to overwrite "foo" with "bar"). We
  // ignore \r when not followed by \n, then re-tokenize as text.
  out = out.replace(/[^\r\n]*\r(?!\n)/g, '');
  // Collapse runs of 3+ newlines to 2 for chat-friendly spacing.
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}
