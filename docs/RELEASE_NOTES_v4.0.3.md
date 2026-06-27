# Catalyst UI v4.0.3 — release notes

Bug-fix release. v4.0.2 shipped with four issues users surfaced in the dev build — one was an
unhandled main-process exception that popped a modal error dialog. Strictly fixes only, no new
features.

## Fixed

- **`Cannot resize a pty that has already exited` crash.** When a PTY exited (Claude (Chat)
  fast-exit, Ollama tab close, etc.) and the renderer's ResizeObserver / panel re-flow fired a
  delayed resize, `PtyManager.resize` called into node-pty on the dead handle, throwing a
  synchronous exception that surfaced as a JavaScript-error modal dialog. `PtyManager` now clears
  `ptyProcess` / `childProcess` in the `onExit` handler so subsequent resize/write calls
  short-circuit, with defensive try/catch in `PtyManager.resize` and `PtyRegistry.resize` for the
  rare mid-teardown case.
- **Claude (Chat) yellow stream-json diagnostic was invisible.** The fast-exit diagnostic was gated
  on `profile === 'api.anthropic.claude-chat'`, but `ModelsPanel` wasn't passing `profile` to its
  `EmbeddedTerminal`. It is now passed via `running.find(...).modelId`, so the hint fires in both the
  in-panel embed and the popout window.
- **Commands panel "Stream-JSON mode" empty-state had no way out.** Added a CTA banner —
  "+ Switch to a plain Claude tab" — that spawns a new Claude tab and switches the panel to Terminal.

## Internal

- All five audit harnesses re-run green at 132/132 after the fixes.
- Inline-style longhand triplet on the new CTA banner avoids React's shorthand/longhand reconciler
  warning.
