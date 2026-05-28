import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ChatSkinOverlay } from '../chat-skin/ChatSkinOverlay';
import { isSkinEnabled, setSkinEnabled } from '../chat-skin/skin-prefs';

/**
 * Inline xterm.js viewer for a model PTY launched from the Models panel.
 *
 * Unlike TerminalPanel, this one:
 *   - Does NOT spawn the PTY — it just attaches to an existing paneId
 *     created by MODELS_LAUNCH (which already called PtyRegistry.spawn
 *     with the model's command).
 *   - Disposes the xterm on unmount but does NOT kill the PTY. Kill is
 *     a separate explicit action in the Running list.
 *   - Subscribes to TERMINAL_DATA/EXIT for the given paneId, forwards
 *     input to TERMINAL_INPUT, and reports resizes via TERMINAL_RESIZE.
 *
 * Sized to fit its container; ResizeObserver triggers fit() when the
 * Models panel re-flows.
 */

interface Props {
  paneId: string;
  /** Compact mode reduces font size + padding (default true for in-panel). */
  compact?: boolean;
  /** When provided, the embed registers a `sendInput`-backed sender under
   *  the given paneId so the palette / snippets / Commands tab can route
   *  text into this model's PTY just like they do for Claude tabs. */
  registerSender?: (
    paneId: string,
    send: ((data: string) => void) | null
  ) => void;
  /** Fired once the embed confirms the PTY is alive (via models:list-running).
   *  Same signature as TerminalPanel's onPidChange so the StatusBar PID
   *  footer works for model tabs the same way it does for Claude tabs. */
  onPidChange?: (paneId: string, pid: number) => void;
  /** True when this is the currently-visible tab. Used to scope the
   *  focus-active-terminal window event (PR #27 M-1 polish fix) so
   *  only the visible pane claims focus when a starter command fires. */
  active?: boolean;
  /** Catalog profile id of the tab. Threaded through to ChatSkinOverlay
   *  so it can pick the JSON-stream renderer for chat-mode profiles. */
  profile?: string;
}

export function EmbeddedTerminal({
  paneId,
  compact = true,
  registerSender,
  onPidChange,
  active,
  profile,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Per-pane chat-skin toggle, persisted via skin-prefs (localStorage).
  // Synced with TerminalPanel so the SAME paneId surfaces the SAME skin
  // state whether viewed via TerminalPanel, EmbeddedTerminal, or PopoutView.
  const [skinOn, setSkinOn] = useState<boolean>(() => isSkinEnabled(paneId));
  const toggleSkin = useCallback(() => {
    setSkinOn((prev) => {
      const next = !prev;
      setSkinEnabled(paneId, next);
      return next;
    });
  }, [paneId]);
  const fitRef = useRef<FitAddon | null>(null);

  const fitIfChanged = useCallback(() => {
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    let dims: ReturnType<FitAddon['proposeDimensions']>;
    try {
      dims = fit.proposeDimensions();
    } catch {
      return;
    }
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
    if (dims.cols < 1 || dims.rows < 1) return;
    if (dims.cols === term.cols && dims.rows === term.rows) return;
    fit.fit();
    window.electronAPI.terminal.resize(paneId, term.cols, term.rows);
  }, [paneId]);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;

    const term = new Terminal({
      theme: {
        background: '#0a0a14',
        foreground: '#ececf1',
        cursor: '#a78bfa',
        cursorAccent: '#0a0a14',
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Consolas", monospace',
      fontSize: compact ? 12 : 14,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit + write banner so the embed isn't blank if the PTY is
    // slow to produce output.
    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* host not measured yet — first resize observer fires shortly */
      }
    });

    const offData = window.electronAPI.terminal.onData(paneId, (data: string) => {
      term.write(data);
    });
    const offExit = window.electronAPI.terminal.onExit(paneId, (code: number) => {
      term.write(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`);
    });

    // 3.0.0-beta.3: probe whether the PTY actually exists. If the user
    // clicks Pop-out on a stale running-list entry (e.g. after panel
    // re-mount with a launched PTY that died while away), the embed will
    // be silent forever — write a placeholder so they know what happened.
    // PR #23 (post-handoff): also harvest the PID from the same probe
    // and fire onPidChange so the StatusBar PID footer surfaces a real
    // number for model tabs (mirrors TerminalPanel's onReady wiring,
    // which doesn't exist for already-spawned PTYs).
    setTimeout(() => {
      void (async () => {
        try {
          const live = await window.electronAPI.models.listRunning();
          const myPane = live.find((p) => p.paneId === paneId);
          if (!myPane) {
            term.write(`\x1b[33m[paneId ${paneId} not found — the model may have exited.]\x1b[0m\r\n`);
            term.write(`\x1b[2mClose this view and Launch again from the Models panel.\x1b[0m\r\n`);
            return;
          }
          if (myPane.pid > 0) {
            onPidChange?.(paneId, myPane.pid);
          }
        } catch {
          // listRunning unavailable — skip the warning; the PTY may still be live
        }
      })();
    }, 1500);

    const offUserInput = term.onData((data) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    // Register a sender so external callers (palette, snippets, the
    // Commands sidebar) can write to this model's PTY just like Claude
    // tabs. Without this, sendToActive in App.tsx silently no-ops when a
    // model tab is focused — fixes H-1 from the TerminalTabs red-team.
    registerSender?.(paneId, (data: string) => {
      window.electronAPI.terminal.sendInput(paneId, data);
    });

    const ro = new ResizeObserver(() => fitIfChanged());
    ro.observe(host);

    return () => {
      ro.disconnect();
      offData();
      offExit();
      offUserInput.dispose();
      registerSender?.(paneId, null);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [paneId, compact, fitIfChanged, registerSender, onPidChange]);

  // Mirror TerminalPanel's auto-focus-on-starter-command behavior so
  // model tabs (Ollama's `/set system `, etc.) get keyboard focus
  // when the user clicks a Quick Action with submit:false. Only the
  // active tab claims focus. PR #27, M-1 polish fix.
  useEffect(() => {
    if (!active) return;
    const onFocusReq = () => {
      try {
        termRef.current?.focus();
      } catch {
        // term may not be mounted yet — first frame is the worst case.
      }
    };
    window.addEventListener('ccs-focus-active-terminal', onFocusReq);
    return () => window.removeEventListener('ccs-focus-active-terminal', onFocusReq);
  }, [active]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 180,
      }}
    >
      <div
        ref={hostRef}
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a14',
          borderRadius: 6,
          padding: 6,
          boxSizing: 'border-box',
          overflow: 'hidden',
          visibility: skinOn ? 'hidden' : 'visible',
        }}
      />

      {!skinOn && (
        <button
          onClick={toggleSkin}
          title="Switch to chat skin"
          aria-label="Switch to chat skin"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid var(--border, rgba(255,255,255,0.1))',
            background: 'rgba(15,15,26,0.7)',
            color: 'var(--text-secondary, #8b8b9e)',
            backdropFilter: 'blur(4px)',
            cursor: 'pointer',
            fontSize: 11,
            opacity: 0.6,
            transition: 'opacity 120ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
        >
          ✦ Chat
        </button>
      )}

      <ChatSkinOverlay
        paneId={paneId}
        visible={skinOn}
        onToggleOff={toggleSkin}
        profile={profile}
      />
    </div>
  );
}
