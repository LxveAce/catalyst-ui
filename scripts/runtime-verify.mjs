#!/usr/bin/env node
/**
 * Runtime verification harness for Claude Code Studio.
 *
 * Spawns the app via `npm start -- --remote-debugging-port=9222`, connects
 * to Chromium's DevTools Protocol on the main renderer page, and:
 *   1. enumerates all sidebar buttons (the `aria-label`-tagged panel switches),
 *   2. clicks each one in turn with a small pause,
 *   3. captures console.* + exception events the entire time,
 *   4. captures the main process stdout to a log file,
 *   5. produces a per-tab pass/fail summary.
 *
 * Usage:
 *   node scripts/runtime-verify.mjs [--keep-running] [--ports=9222]
 *
 * Output:
 *   - runtime-verify-main.log  (main-process stdout/stderr while running)
 *   - runtime-verify-console.log  (renderer console events)
 *   - runtime-verify-summary.md  (per-tab pass/fail report)
 *
 * Why this exists: the Electron app is a GUI; from a script we have no way
 * to "click a button" without a remote-control protocol. CDP is what
 * Chromium has built in for exactly this. No extra npm deps required —
 * Node 22+'s built-in WebSocket suffices.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9222;
const HOST = '127.0.0.1';
const BOOT_TIMEOUT_MS = 90_000;      // generous; Vite + node-pty + everything
const PER_TAB_DWELL_MS = 1500;       // time spent on each tab to absorb events
const KEEP_RUNNING = process.argv.includes('--keep-running');

const LOG_MAIN = 'runtime-verify-main.log';
const LOG_CONSOLE = 'runtime-verify-console.log';
const LOG_SUMMARY = 'runtime-verify-summary.md';

/**
 * Spawn the Electron app via electron-forge's `npm start`. We attach the
 * remote-debugging-port flag through `-- …` so forge passes it to Electron
 * which passes it to Chromium.
 */
function spawnApp() {
  const mainStream = createWriteStream(LOG_MAIN, { flags: 'w' });
  // Double `--`: first separator passes args from npm to the start script
  // (electron-forge); second separator passes args from forge through to
  // Electron itself. Without the double-up, forge treats `--remote-
  // debugging-port=9222` as one of its own options and errors out.
  const child = spawn(
    'npm',
    ['start', '--', '--', `--remote-debugging-port=${PORT}`],
    {
      cwd: process.cwd(),
      shell: true,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  child.stdout.pipe(mainStream, { end: false });
  child.stderr.pipe(mainStream, { end: false });
  child.on('exit', (code, signal) => {
    mainStream.write(`\n[runtime-verify] app exited code=${code} signal=${signal}\n`);
    mainStream.end();
  });
  return child;
}

/**
 * Poll CDP /json/list until a renderer page is exposed, or timeout.
 * Filters out the empty pages forge sometimes spins up.
 */
async function waitForRendererPage() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        // Prefer pages with title containing 'Claude' or url starting with
        // the dev server (vite). Fall back to the first 'page' type.
        const main =
          pages.find(
            (p) =>
              p.type === 'page' &&
              (p.title?.includes('Claude') || p.url?.includes('localhost:'))
          ) ?? pages.find((p) => p.type === 'page');
        if (main?.webSocketDebuggerUrl) return main;
      }
    } catch {
      // CDP endpoint not up yet — keep polling.
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for renderer CDP endpoint.');
}

/**
 * Tiny CDP client: sends Method calls over a single WebSocket, awaits
 * matching responses by id. Also exposes an event handler for unsolicited
 * notifications (Runtime.consoleAPICalled, Runtime.exceptionThrown, etc.).
 */
function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const eventHandlers = new Map();
  let nextId = 1;
  let ready;
  const readyPromise = new Promise((r) => (ready = r));

  ws.addEventListener('open', () => ready());
  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data.toString());
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      const handlers = eventHandlers.get(msg.method) ?? [];
      for (const h of handlers) {
        try {
          h(msg.params);
        } catch {
          // ignore
        }
      }
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  function on(method, handler) {
    if (!eventHandlers.has(method)) eventHandlers.set(method, []);
    eventHandlers.get(method).push(handler);
  }
  return { send, on, close: () => ws.close(), ready: readyPromise };
}

/**
 * Stringify a CDP consoleAPICalled remote object. Best-effort; the goal is
 * legibility in the log, not a perfect repr.
 */
function fmtArg(arg) {
  if (arg.type === 'string') return JSON.stringify(arg.value);
  if (arg.type === 'number' || arg.type === 'boolean')
    return String(arg.value);
  if (arg.type === 'undefined') return 'undefined';
  if (arg.subtype === 'null') return 'null';
  if (arg.subtype === 'error')
    return arg.description?.split('\n')[0] ?? '[Error]';
  if (arg.preview) return JSON.stringify(arg.preview);
  return arg.description ?? `[${arg.type}]`;
}

/**
 * Drive the app: enable Runtime + Console events, query the sidebar buttons,
 * click each one in turn, and capture all console events keyed by the
 * "current" tab.
 */
async function driveApp(cdp) {
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  /** Console + exception events grouped per current-tab context. */
  const events = [];
  let currentTab = '(boot)';
  cdp.on('Runtime.consoleAPICalled', (p) => {
    events.push({
      tab: currentTab,
      kind: 'console.' + p.type,
      text: (p.args ?? []).map(fmtArg).join(' '),
      stack: p.stackTrace?.callFrames?.slice(0, 2),
    });
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    events.push({
      tab: currentTab,
      kind: 'exception',
      text:
        p.exceptionDetails?.text +
        ' ' +
        (p.exceptionDetails?.exception?.description?.split('\n')[0] ?? ''),
      stack: p.exceptionDetails?.stackTrace?.callFrames?.slice(0, 3),
    });
  });
  cdp.on('Page.loadEventFired', () => {
    events.push({ tab: currentTab, kind: 'page.load', text: 'page loaded' });
  });

  // Poll until React has mounted and the data-panel attributes exist.
  // The CDP page-list returns as soon as the renderer process has loaded
  // the URL, but the React tree may take another 5-10s to finish first
  // compile on a Vite cold start. Without this poll we'd query before
  // any panel buttons exist and get 0 hits.
  const mountDeadline = Date.now() + 30_000;
  let mountedCount = 0;
  while (Date.now() < mountDeadline) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelectorAll('[data-panel]').length`,
      returnByValue: true,
    });
    mountedCount = Number(r.result.value) || 0;
    if (mountedCount > 0) break;
    await sleep(500);
  }
  events.push({
    tab: '(boot)',
    kind: 'info',
    text: `React mount poll: ${mountedCount} [data-panel] elements after wait.`,
  });

  // Enumerate sidebar buttons. After the mount poll we expect the
  // `data-panel` selector to win; the fallbacks are for resilience if
  // someone changes the convention.
  const enumerate = `(() => {
    const queries = [
      '[data-panel]',
      '[aria-label*="panel" i]',
      'nav button',
      'aside button',
    ];
    for (const q of queries) {
      const els = Array.from(document.querySelectorAll(q));
      if (els.length >= 3) {
        return els.map((el, i) => ({
          index: i,
          label: el.getAttribute('aria-label') || el.getAttribute('data-panel') || el.title || (el.textContent || '').trim().slice(0, 40),
          selector: q,
        }));
      }
    }
    // Fallback: every button inside the leftmost vertical flex container.
    const allButtons = Array.from(document.querySelectorAll('button'));
    return allButtons.slice(0, 20).map((el, i) => ({
      index: i,
      label: (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 40),
      selector: 'button',
    }));
  })()`;

  const enumeration = await cdp.send('Runtime.evaluate', {
    expression: enumerate,
    returnByValue: true,
  });
  const buttons = enumeration.result.value ?? [];

  events.push({
    tab: '(boot)',
    kind: 'info',
    text: `Found ${buttons.length} candidate buttons via selector "${buttons[0]?.selector ?? 'n/a'}". Labels: ${buttons.map((b) => b.label).slice(0, 12).join(' | ')}`,
  });

  // Click each one in turn.
  const visited = [];
  for (const btn of buttons.slice(0, 14)) {
    currentTab = btn.label || `(button ${btn.index})`;
    const click = `(() => {
      const els = document.querySelectorAll(${JSON.stringify(btn.selector)});
      const el = els[${btn.index}];
      if (!el) return { ok: false, reason: 'element vanished' };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true, label: el.getAttribute('aria-label') || el.title || (el.textContent || '').trim().slice(0, 40) };
    })()`;
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: click,
        returnByValue: true,
        userGesture: true,
      });
      events.push({
        tab: currentTab,
        kind: 'info',
        text: `Click result: ${JSON.stringify(r.result.value)}`,
      });
    } catch (e) {
      events.push({ tab: currentTab, kind: 'click-error', text: String(e) });
    }
    visited.push(btn.label);
    await sleep(PER_TAB_DWELL_MS);
  }

  currentTab = '(post-clicks)';
  // Settle for any late console events.
  await sleep(2000);

  // === Extended pass: tab gestures + Commands family chip + palette ========
  // Added when wiring TerminalTabs + the Commands-tab-mirror change so we
  // catch regressions in the new UI surfaces, not just bare panel renders.
  // Each step records a synthetic event with `currentTab = '(ext:<name>)'`
  // and asserts a DOM invariant; failures show up in the summary as
  // exception events (via `throw`) which the existing per-tab tally
  // counts as ❌.

  const extResults = [];
  async function evalExpr(expression) {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.text +
          ' ' +
          (r.exceptionDetails.exception?.description?.split('\n')[0] ?? '')
      );
    }
    return r.result.value;
  }
  async function assertEq(name, expected, actualExpr) {
    try {
      const actual = await evalExpr(actualExpr);
      const pass = actual === expected;
      extResults.push({ name, expected, actual, pass });
      events.push({
        tab: `(ext:${name})`,
        kind: pass ? 'info' : 'console.error',
        text: pass
          ? `OK: ${name} = ${JSON.stringify(actual)}`
          : `FAIL: ${name} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
      });
    } catch (e) {
      extResults.push({ name, expected, actual: 'ERROR', pass: false });
      events.push({
        tab: `(ext:${name})`,
        kind: 'exception',
        text: `${name}: ${e.message}`,
      });
    }
  }
  async function clickSelector(name, selector, index = 0) {
    const expr = `(() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      const el = els[${index}];
      if (!el) return { ok: false, reason: 'no element matched ' + ${JSON.stringify(selector)} };
      el.scrollIntoView({ block: 'center' });
      el.click();
      return { ok: true };
    })()`;
    const r = await evalExpr(expr);
    events.push({
      tab: `(ext:${name})`,
      kind: r?.ok ? 'info' : 'click-error',
      text: `click ${selector}[${index}]: ${JSON.stringify(r)}`,
    });
  }
  async function dispatchKey(key, modifiers = 0) {
    // Modifiers bitmask: 1=Alt, 2=Ctrl, 4=Meta, 8=Shift. We use keydown
    // then keyup; React listens to keydown for the global hotkey dispatcher.
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      modifiers,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      modifiers,
    });
  }

  // Make sure we're on the Terminal panel so TerminalTabs is visible.
  currentTab = '(ext:setup)';
  await clickSelector('switch-to-terminal', '[data-panel="terminal"]');
  await sleep(400);

  // --- Test 1: tab strip count + button --------------------------------------
  currentTab = '(ext:tab-add)';
  const initialCount = await evalExpr(
    `document.querySelectorAll('[data-terminal-tab]').length`
  );
  events.push({
    tab: '(ext:tab-add)',
    kind: 'info',
    text: `initial tab count: ${initialCount}`,
  });
  await clickSelector('new-claude-tab', '[aria-label="New Claude tab"]');
  await sleep(500);
  await assertEq(
    'tab-add-increments-count',
    initialCount + 1,
    `document.querySelectorAll('[data-terminal-tab]').length`
  );
  await assertEq(
    'tab-add-newest-is-active',
    'true',
    `(() => {
      const tabs = document.querySelectorAll('[data-terminal-tab]');
      const last = tabs[tabs.length - 1];
      return last?.getAttribute('data-tab-active') ?? 'none';
    })()`
  );

  // --- Test 2: close the new tab returns to initial count --------------------
  currentTab = '(ext:tab-close)';
  await clickSelector(
    'close-newest-tab',
    '[data-terminal-tab] [aria-label^="Close "]',
    initialCount // close button under the newest tab
  );
  await sleep(500);
  await assertEq(
    'tab-close-restores-count',
    initialCount,
    `document.querySelectorAll('[data-terminal-tab]').length`
  );

  // --- Test 3: profile picker open / Esc close -------------------------------
  currentTab = '(ext:picker)';
  await clickSelector('open-picker', '[aria-label="Pick a profile"]');
  await sleep(300);
  await assertEq(
    'picker-opens',
    1,
    `document.querySelectorAll('[data-profile-picker]').length`
  );
  // Press Escape to close.
  await dispatchKey('Escape', 0);
  await sleep(300);
  await assertEq(
    'picker-closes-on-esc',
    0,
    `document.querySelectorAll('[data-profile-picker]').length`
  );

  // --- Test 4: Commands family chip on a Claude tab --------------------------
  currentTab = '(ext:family-chip)';
  await clickSelector('switch-to-commands', '[data-panel="commands"]');
  await sleep(400);
  await assertEq(
    'commands-chip-is-claude',
    'claude',
    `document.querySelector('[data-family-chip]')?.getAttribute('data-family-chip') ?? 'none'`
  );
  // textContent ignores CSS text-transform — the literal config label is
  // 'Claude' (rendered as CLAUDE via text-transform: uppercase).
  await assertEq(
    'commands-chip-label-text',
    'Claude',
    `document.querySelector('[data-family-chip]')?.textContent?.trim() ?? 'none'`
  );

  // --- Test 5: Ctrl+Shift+P opens the palette, Esc closes it -----------------
  currentTab = '(ext:palette)';
  // Switch back to Terminal so the palette doesn't open over CommandsPanel
  // (cosmetic only, but keeps the focus state predictable).
  await clickSelector('switch-back-terminal', '[data-panel="terminal"]');
  await sleep(300);
  // Ctrl+Shift+P (Ctrl=2 | Shift=8 = 10 in CDP modifier bitmask).
  await dispatchKey('p', 10);
  await sleep(400);
  await assertEq(
    'palette-opens-on-hotkey',
    1,
    `document.querySelectorAll('input[placeholder="Type a command, snippet, or theme…"]').length`
  );
  await dispatchKey('Escape', 0);
  await sleep(300);
  await assertEq(
    'palette-closes-on-esc',
    0,
    `document.querySelectorAll('input[placeholder="Type a command, snippet, or theme…"]').length`
  );

  currentTab = '(ext:summary)';
  const passCount = extResults.filter((r) => r.pass).length;
  const failCount = extResults.length - passCount;
  events.push({
    tab: '(ext:summary)',
    kind: failCount === 0 ? 'info' : 'console.error',
    text: `Extended verification: ${passCount}/${extResults.length} assertions passed${failCount > 0 ? ` (${failCount} FAILED)` : ''}`,
  });

  return { buttons, visited, events };
}

function generateSummary(report) {
  const { buttons, visited, events } = report;
  const byTab = new Map();
  for (const e of events) {
    if (!byTab.has(e.tab)) byTab.set(e.tab, []);
    byTab.get(e.tab).push(e);
  }
  let md = `# Runtime verification — ${new Date().toISOString()}\n\n`;
  md += `**Buttons found:** ${buttons.length}\n`;
  md += `**Buttons clicked:** ${visited.length}\n\n`;
  md += `## Per-tab events\n\n`;
  for (const [tab, evs] of byTab) {
    const errors = evs.filter(
      (e) =>
        e.kind === 'exception' ||
        e.kind === 'console.error' ||
        e.kind === 'click-error'
    );
    const warnings = evs.filter((e) => e.kind === 'console.warning');
    const verdict = errors.length === 0 ? '✅ pass' : `❌ ${errors.length} error(s)`;
    md += `### ${tab} — ${verdict}\n\n`;
    if (errors.length === 0 && warnings.length === 0 && evs.length === 0) {
      md += `_(no events)_\n\n`;
      continue;
    }
    if (errors.length > 0) {
      md += `**Errors:**\n`;
      for (const e of errors) {
        md += `- \`${e.kind}\`: ${e.text}\n`;
      }
      md += `\n`;
    }
    if (warnings.length > 0) {
      md += `**Warnings:**\n`;
      for (const e of warnings) {
        md += `- ${e.text}\n`;
      }
      md += `\n`;
    }
    const info = evs.filter(
      (e) =>
        e.kind === 'info' ||
        e.kind === 'console.log' ||
        e.kind === 'page.load'
    );
    if (info.length > 0) {
      md += `**Other events (${info.length}):** ${info
        .map((e) => e.kind)
        .join(', ')}\n\n`;
    }
  }
  md += `\n## Full console log\n\nSee \`${LOG_CONSOLE}\` for raw events.\n`;
  return md;
}

async function main() {
  console.log('[runtime-verify] spawning app via npm start…');
  const child = spawnApp();

  let report;
  try {
    console.log(`[runtime-verify] waiting for CDP on :${PORT}…`);
    const page = await waitForRendererPage();
    console.log(`[runtime-verify] found page: ${page.title || page.url}`);
    const cdp = openCdp(page.webSocketDebuggerUrl);
    await cdp.ready;
    console.log('[runtime-verify] CDP connected; driving sidebar…');
    report = await driveApp(cdp);
    cdp.close();
  } catch (e) {
    console.error('[runtime-verify] ERROR:', e.message);
    report = { buttons: [], visited: [], events: [{ tab: '(boot)', kind: 'exception', text: e.message }] };
  } finally {
    if (!KEEP_RUNNING) {
      console.log('[runtime-verify] killing app…');
      try {
        child.kill();
      } catch {}
    }
  }

  writeFileSync(LOG_CONSOLE, JSON.stringify(report.events, null, 2));
  const summary = generateSummary(report);
  writeFileSync(LOG_SUMMARY, summary);

  console.log(`[runtime-verify] wrote ${LOG_MAIN}`);
  console.log(`[runtime-verify] wrote ${LOG_CONSOLE}`);
  console.log(`[runtime-verify] wrote ${LOG_SUMMARY}`);

  // Print summary head so the caller doesn't have to open the file.
  console.log('\n' + summary.split('\n').slice(0, 80).join('\n'));
}

main().catch((e) => {
  console.error('[runtime-verify] fatal:', e);
  process.exit(1);
});
