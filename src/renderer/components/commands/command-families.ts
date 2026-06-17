/**
 * Per-profile command families surfaced by the Commands sidebar panel.
 *
 * The "family" is a CLI/runtime grouping (not a per-model fork) — every
 * Ollama-launched model shares the `ollama` REPL slash commands, every
 * Aider-launched model shares Aider's commands, etc. Profile family is
 * derived in App.tsx from the active tab's profile + the model catalog
 * entry's `command` field; this file owns the *data* per family.
 *
 * Curated, not exhaustive: we list the commands users typically reach
 * for. Add more here when you hit one missing — there's no schema
 * gymnastics required.
 */

export type CommandFamily =
  | 'claude'
  | 'claude-chat'
  | 'ollama'
  | 'aider'
  | 'gemini'
  | 'bitnet'
  | 'unknown';

export interface CommandEntry {
  name: string;
  description: string;
}

export interface CommandDef {
  label: string;
  command: string;
  description: string;
  category: string;
  /** When false, the command lands in the terminal *without* a trailing
   *  submit (CR / newline). Used for "starter" commands like Aider's
   *  `/add ` that need a filename after them — auto-submitting would
   *  send `/add ` with no arg and the CLI errors out. Default `true`. */
  submit?: boolean;
}

export interface CommandFamilyConfig {
  family: CommandFamily;
  /** Human-readable name shown in the header chip. */
  label: string;
  /** Slash commands grouped by section, rendered on the "All Commands" tab. */
  slashCommands: Record<string, CommandEntry[]>;
  /** Curated quick-action commands shown as buttons. */
  quickCommands: CommandDef[];
  /** Category pills above the quick-actions list (in display order). */
  quickCategories: string[];
  /** Keyboard shortcuts the user can hit *inside* the CLI's REPL.
   *  Terminal-level shortcuts (xterm focus, copy/paste) live in
   *  the app's hotkey settings, not here. */
  shortcuts: CommandEntry[];
  /** Optional message shown when the family has no curated commands
   *  (e.g., 'unknown'). Null = render the (empty) lists normally. */
  emptyMessage?: string;
}

// --- Claude -----------------------------------------------------------------

const CLAUDE_SLASH: Record<string, CommandEntry[]> = {
  'Model & Effort': [
    { name: '/model [model]', description: 'Set model (opus, sonnet, haiku)' },
    { name: '/effort [level]', description: 'Set effort: low, medium, high, max' },
    { name: '/fast [on|off]', description: 'Toggle fast output mode' },
  ],
  Session: [
    { name: '/clear', description: 'Start new conversation' },
    { name: '/resume [session]', description: 'Resume session by ID or name' },
    { name: '/compact [instructions]', description: 'Free up context' },
    { name: '/context [all]', description: 'Visualize context usage' },
    { name: '/branch [name]', description: 'Create conversation branch' },
    { name: '/rename [name]', description: 'Rename current session' },
    { name: '/export [filename]', description: 'Export conversation as text' },
    { name: '/copy [N]', description: 'Copy last N responses' },
    { name: '/rewind', description: 'Rewind to previous point' },
    { name: '/background [prompt]', description: 'Detach to background' },
  ],
  Workflow: [
    { name: '/plan [desc]', description: 'Enter plan mode' },
    { name: '/review [PR]', description: 'Review pull request' },
    { name: '/diff', description: 'View uncommitted changes' },
    { name: '/simplify [focus]', description: 'Code quality review' },
    { name: '/batch <instr>', description: 'Parallel codebase changes' },
    { name: '/loop [interval]', description: 'Run prompt repeatedly' },
    { name: '/goal [condition]', description: 'Work until goal met' },
  ],
  Config: [
    { name: '/init', description: 'Initialize project with CLAUDE.md' },
    { name: '/memory', description: 'Edit CLAUDE.md memory files' },
    { name: '/permissions', description: 'Manage tool permissions' },
    { name: '/config', description: 'Open settings UI' },
    { name: '/mcp', description: 'Manage MCP servers' },
    { name: '/theme', description: 'Change color theme' },
    { name: '/debug [desc]', description: 'Enable debug logging' },
    { name: '/hooks', description: 'View hook configurations' },
  ],
  'Info & Utils': [
    { name: '/help', description: 'Show help' },
    { name: '/usage', description: 'Session cost & usage' },
    { name: '/doctor', description: 'Diagnose installation' },
    { name: '/feedback', description: 'Submit feedback' },
    { name: '/btw <q>', description: 'Quick side question' },
    { name: '/recap', description: 'Session summary' },
    { name: '/tasks', description: 'List background tasks' },
  ],
};

const CLAUDE_QUICK: CommandDef[] = [
  { label: 'Opus', command: '/model opus', description: 'Most capable model', category: 'Model' },
  { label: 'Sonnet', command: '/model sonnet', description: 'Fast & capable', category: 'Model' },
  { label: 'Haiku', command: '/model haiku', description: 'Fastest model', category: 'Model' },
  { label: 'Fast Mode', command: '/fast', description: 'Toggle fast output', category: 'Model' },
  { label: 'Max', command: '/effort max', description: 'Maximum reasoning', category: 'Effort' },
  { label: 'High', command: '/effort high', description: 'High reasoning', category: 'Effort' },
  { label: 'Medium', command: '/effort medium', description: 'Balanced', category: 'Effort' },
  { label: 'Low', command: '/effort low', description: 'Quick responses', category: 'Effort' },
  { label: 'Compact', command: '/compact', description: 'Summarize & free context', category: 'Session' },
  { label: 'Clear', command: '/clear', description: 'New conversation', category: 'Session' },
  { label: 'Resume', command: '/resume', description: 'Resume previous', category: 'Session' },
  { label: 'Context', command: '/context', description: 'View usage grid', category: 'Session' },
  { label: 'Plan', command: '/plan', description: 'Enter plan mode', category: 'Workflow' },
  { label: 'Review', command: '/review', description: 'Review PR', category: 'Workflow' },
  { label: 'Diff', command: '/diff', description: 'View changes', category: 'Workflow' },
  { label: 'Simplify', command: '/simplify', description: 'Code quality check', category: 'Workflow' },
  { label: 'Usage', command: '/usage', description: 'Session cost & stats', category: 'Info' },
  { label: 'Help', command: '/help', description: 'Show help', category: 'Info' },
  { label: 'Doctor', command: '/doctor', description: 'Diagnose install', category: 'Info' },
  { label: 'Permissions', command: '/permissions', description: 'Manage tools', category: 'Config' },
  { label: 'Memory', command: '/memory', description: 'Edit memory files', category: 'Config' },
  { label: 'Init', command: '/init', description: 'Initialize project', category: 'Config' },
];

const CLAUDE_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Interrupt or clear input' },
  { name: 'Escape', description: 'Stop response' },
  { name: 'Ctrl+D', description: 'Exit Claude Code' },
  { name: 'Ctrl+R', description: 'Search history' },
  { name: 'Ctrl+O', description: 'Toggle transcript' },
  { name: 'Ctrl+L', description: 'Redraw screen' },
  { name: 'Shift+Tab', description: 'Cycle permission modes' },
  { name: 'Alt+P', description: 'Switch model' },
  { name: 'Alt+T', description: 'Toggle thinking' },
  { name: 'Alt+O', description: 'Toggle fast mode' },
  { name: 'Ctrl+J', description: 'Newline in input' },
];

// --- Ollama (`ollama run <model>` REPL) -------------------------------------

const OLLAMA_SLASH: Record<string, CommandEntry[]> = {
  'Show & Inspect': [
    { name: '/show info', description: 'Show model info' },
    { name: '/show parameters', description: 'Show runtime parameters' },
    { name: '/show template', description: 'Show prompt template' },
    { name: '/show system', description: 'Show system message' },
    { name: '/show modelfile', description: 'Show the Modelfile' },
    { name: '/show license', description: 'Show license' },
  ],
  Session: [
    { name: '/clear', description: 'Clear session context' },
    { name: '/load <model>', description: 'Switch to another model' },
    { name: '/save <name>', description: 'Save session as a new model' },
    { name: '/bye', description: 'Exit (Ctrl+D also works)' },
  ],
  Settings: [
    { name: '/set system <prompt>', description: 'Set the system prompt' },
    { name: '/set parameter <k> <v>', description: 'Tune runtime parameter' },
    { name: '/set history', description: 'Enable history' },
    { name: '/set nohistory', description: 'Disable history' },
    { name: '/set wordwrap', description: 'Enable word-wrap' },
    { name: '/set nowordwrap', description: 'Disable word-wrap' },
  ],
  Help: [
    { name: '/?', description: 'Show command help' },
    { name: '/help', description: 'Show command help' },
  ],
};

const OLLAMA_QUICK: CommandDef[] = [
  { label: 'Model info', command: '/show info', description: 'Model metadata', category: 'Inspect' },
  { label: 'Parameters', command: '/show parameters', description: 'Runtime params', category: 'Inspect' },
  { label: 'System prompt', command: '/show system', description: 'Current system prompt', category: 'Inspect' },
  { label: 'License', command: '/show license', description: 'Model license', category: 'Inspect' },
  { label: 'Clear', command: '/clear', description: 'Reset session context', category: 'Session' },
  { label: 'Exit', command: '/bye', description: 'Leave the REPL', category: 'Session' },
  { label: 'Set system', command: '/set system ', description: 'Then type the prompt', category: 'Settings', submit: false },
  { label: 'History on', command: '/set history', description: 'Enable history', category: 'Settings' },
  { label: 'History off', command: '/set nohistory', description: 'Disable history', category: 'Settings' },
  { label: 'Help', command: '/?', description: 'Command help', category: 'Info' },
];

const OLLAMA_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Interrupt generation' },
  { name: 'Ctrl+D', description: 'Exit REPL' },
  { name: 'Up / Down', description: 'History (with /set history)' },
];

// --- Aider ------------------------------------------------------------------

const AIDER_SLASH: Record<string, CommandEntry[]> = {
  Files: [
    { name: '/add <file>', description: 'Add file(s) to the chat' },
    { name: '/drop <file>', description: 'Remove file(s) from the chat' },
    { name: '/ls', description: 'List files in the chat' },
    { name: '/read-only <file>', description: 'Add as read-only reference' },
    { name: '/load <file>', description: 'Run aider commands from a file' },
  ],
  Modes: [
    { name: '/code [prompt]', description: 'Request code changes (default)' },
    { name: '/ask [prompt]', description: 'Ask without changing code' },
    { name: '/architect [prompt]', description: 'Architect mode (plan first)' },
    { name: '/chat-mode <mode>', description: 'Switch chat mode' },
  ],
  Git: [
    { name: '/diff', description: 'Show diff of pending changes' },
    { name: '/commit', description: 'Commit pending changes' },
    { name: '/undo', description: 'Undo the last commit aider made' },
    { name: '/git <cmd>', description: 'Run any git command' },
  ],
  Run: [
    { name: '/run <cmd>', description: 'Run a shell command (share output)' },
    { name: '/test <cmd>', description: 'Run the project test command' },
    { name: '/lint <cmd>', description: 'Run the project lint command' },
  ],
  Session: [
    { name: '/clear', description: 'Clear chat history' },
    { name: '/reset', description: 'Drop all files + clear history' },
    { name: '/tokens', description: 'Show token usage' },
    { name: '/model <name>', description: 'Switch model' },
    { name: '/quit', description: 'Exit aider (/exit also works)' },
  ],
  Help: [
    { name: '/help', description: 'Show command help' },
  ],
};

const AIDER_QUICK: CommandDef[] = [
  // "Starter" commands — trailing-space + submit:false so the command
  // lands typed in the prompt and the user can finish the argument.
  { label: 'Add file', command: '/add ', description: 'Then type the path', category: 'Files', submit: false },
  { label: 'Drop file', command: '/drop ', description: 'Then type the path', category: 'Files', submit: false },
  { label: 'List files', command: '/ls', description: 'Files in chat', category: 'Files' },
  { label: 'Diff', command: '/diff', description: 'Pending changes', category: 'Git' },
  { label: 'Commit', command: '/commit', description: 'Commit changes', category: 'Git' },
  { label: 'Undo', command: '/undo', description: "Undo aider's last commit", category: 'Git' },
  { label: 'Ask', command: '/ask ', description: "Ask, don't change code", category: 'Mode', submit: false },
  { label: 'Code', command: '/code ', description: 'Request code changes', category: 'Mode', submit: false },
  { label: 'Architect', command: '/architect ', description: 'Plan-first mode', category: 'Mode', submit: false },
  { label: 'Run', command: '/run ', description: 'Shell command + share output', category: 'Run', submit: false },
  { label: 'Test', command: '/test', description: 'Project test command', category: 'Run' },
  { label: 'Lint', command: '/lint', description: 'Project lint command', category: 'Run' },
  { label: 'Clear', command: '/clear', description: 'Clear chat history', category: 'Session' },
  { label: 'Reset', command: '/reset', description: 'Drop files + clear', category: 'Session' },
  { label: 'Tokens', command: '/tokens', description: 'Token usage', category: 'Session' },
  { label: 'Quit', command: '/quit', description: 'Exit aider', category: 'Session' },
];

const AIDER_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Interrupt aider' },
  { name: 'Ctrl+D', description: 'Exit aider' },
  { name: 'Ctrl+Up / Down', description: 'Multi-line prompt navigation' },
];

// --- Gemini CLI -------------------------------------------------------------

const GEMINI_SLASH: Record<string, CommandEntry[]> = {
  Session: [
    { name: '/clear', description: 'Clear chat history' },
    { name: '/exit', description: 'Exit gemini' },
  ],
  Help: [
    { name: '/help', description: 'Show command help' },
  ],
};

const GEMINI_QUICK: CommandDef[] = [
  { label: 'Clear', command: '/clear', description: 'Clear chat history', category: 'Session' },
  { label: 'Help', command: '/help', description: 'Show help', category: 'Info' },
  { label: 'Exit', command: '/exit', description: 'Leave the REPL', category: 'Session' },
];

const GEMINI_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Interrupt generation' },
  { name: 'Ctrl+D', description: 'Exit REPL' },
];

// --- Claude (Chat) — non-interactive stream-json mode ----------------------

// In stream-json mode the CLI doesn't process slash commands the way the
// interactive TUI does — there's no `/clear`, `/compact`, etc. The flow
// is: user submits text → CLI wraps it as a JSON event → response comes
// back as JSON events. Slash commands surfaced here would mislead. We
// keep one terminal-level entry so the Quick Actions tab isn't empty.

const CLAUDE_CHAT_SLASH: Record<string, CommandEntry[]> = {};
const CLAUDE_CHAT_QUICK: CommandDef[] = [];
const CLAUDE_CHAT_SHORTCUTS: CommandEntry[] = [
  { name: 'Enter', description: 'Send message' },
  { name: 'Shift+Enter', description: 'Newline in composer' },
  { name: 'Ctrl+C', description: 'Interrupt Claude (exits the JSON session)' },
];

// --- BitNet (bitnet.cpp llama-style runner) ---------------------------------

const BITNET_SLASH: Record<string, CommandEntry[]> = {
  // bitnet.cpp's interactive mode follows llama.cpp conventions —
  // no command palette to speak of; just a plain prompt.
};

const BITNET_QUICK: CommandDef[] = [];

const BITNET_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Stop generation' },
  { name: 'Ctrl+D', description: 'End input / exit' },
];

// --- Family registry --------------------------------------------------------

export const COMMAND_FAMILIES: Record<CommandFamily, CommandFamilyConfig> = {
  claude: {
    family: 'claude',
    label: 'Claude',
    slashCommands: CLAUDE_SLASH,
    quickCommands: CLAUDE_QUICK,
    quickCategories: ['Model', 'Effort', 'Session', 'Workflow', 'Info', 'Config'],
    shortcuts: CLAUDE_SHORTCUTS,
  },
  'claude-chat': {
    family: 'claude-chat',
    label: 'Claude (Chat)',
    slashCommands: CLAUDE_CHAT_SLASH,
    quickCommands: CLAUDE_CHAT_QUICK,
    quickCategories: [],
    shortcuts: CLAUDE_CHAT_SHORTCUTS,
    emptyMessage:
      'Stream-JSON mode — type your message in the composer; slash commands are not processed in this mode.',
  },
  ollama: {
    family: 'ollama',
    label: 'Ollama',
    slashCommands: OLLAMA_SLASH,
    quickCommands: OLLAMA_QUICK,
    quickCategories: ['Inspect', 'Session', 'Settings', 'Info'],
    shortcuts: OLLAMA_SHORTCUTS,
  },
  aider: {
    family: 'aider',
    label: 'Aider',
    slashCommands: AIDER_SLASH,
    quickCommands: AIDER_QUICK,
    quickCategories: ['Files', 'Mode', 'Git', 'Run', 'Session'],
    shortcuts: AIDER_SHORTCUTS,
  },
  gemini: {
    family: 'gemini',
    label: 'Gemini',
    slashCommands: GEMINI_SLASH,
    quickCommands: GEMINI_QUICK,
    quickCategories: ['Session', 'Info'],
    shortcuts: GEMINI_SHORTCUTS,
  },
  bitnet: {
    family: 'bitnet',
    label: 'BitNet',
    slashCommands: BITNET_SLASH,
    quickCommands: BITNET_QUICK,
    quickCategories: [],
    shortcuts: BITNET_SHORTCUTS,
    emptyMessage:
      'BitNet runs as a plain text REPL — type your prompt directly. No slash commands.',
  },
  unknown: {
    family: 'unknown',
    label: 'Terminal',
    slashCommands: {},
    quickCommands: [],
    quickCategories: [],
    shortcuts: [
      { name: 'Ctrl+C', description: 'Send SIGINT' },
      { name: 'Ctrl+D', description: 'End-of-input' },
    ],
    emptyMessage:
      "Commands haven't been curated for this profile yet — type directly into the terminal.",
  },
};

/**
 * Derive the command family from a tab's profile + the model catalog.
 *
 * - 'claude' is the special-case bundled CLI.
 * - For everything else, look up the catalog entry by id and key off
 *   its `command` field (the CLI binary the PTY spawns).
 */
export function deriveCommandFamily(
  profile: string | null | undefined,
  catalog: { id: string; command?: string; provider?: string }[]
): CommandFamily {
  if (!profile) return 'unknown';
  if (profile === 'claude') return 'claude';
  // The chat-mode profile is keyed by exact id so a future renaming
  // breaks loudly here instead of silently falling through to 'claude'.
  if (profile === 'api.anthropic.claude-chat') return 'claude-chat';
  if (profile === 'bitnet' || profile.startsWith('bitnet')) return 'bitnet';
  const entry = catalog.find((m) => m.id === profile);
  const cmd = (entry?.command ?? '').toLowerCase();
  if (cmd === 'ollama') return 'ollama';
  if (cmd === 'aider') return 'aider';
  if (cmd === 'gemini') return 'gemini';
  if (cmd === 'bitnet') return 'bitnet';
  // Fall back to provider string (handles OpenRouter-via-Aider catalog
  // entries that wrap aider but spell the provider as 'OpenRouter').
  const prov = (entry?.provider ?? '').toLowerCase();
  if (prov.includes('aider') || prov.includes('openrouter')) return 'aider';
  if (prov.includes('ollama')) return 'ollama';
  if (prov.includes('gemini') || prov.includes('google')) return 'gemini';
  return 'unknown';
}
