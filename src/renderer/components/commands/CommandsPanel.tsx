import React, { useState } from 'react';
import { QuickCommands } from './QuickCommands';

interface CommandEntry {
  name: string;
  description: string;
}

const SLASH_COMMANDS: Record<string, CommandEntry[]> = {
  'Model & Effort': [
    { name: '/model [model]', description: 'Set AI model (opus, sonnet, haiku)' },
    { name: '/effort [level]', description: 'Set effort: low, medium, high, xhigh, max' },
    { name: '/fast [on|off]', description: 'Toggle fast output mode' },
  ],
  'Session': [
    { name: '/clear', description: 'Start new conversation' },
    { name: '/resume [session]', description: 'Resume session by ID or name' },
    { name: '/compact [instructions]', description: 'Free up context by summarizing' },
    { name: '/context [all]', description: 'Visualize context usage' },
    { name: '/branch [name]', description: 'Create conversation branch' },
    { name: '/rename [name]', description: 'Rename current session' },
    { name: '/export [filename]', description: 'Export conversation as text' },
    { name: '/copy [N]', description: 'Copy last N responses to clipboard' },
    { name: '/rewind', description: 'Rewind to previous point' },
    { name: '/background [prompt]', description: 'Detach session to background' },
  ],
  'Workflow': [
    { name: '/plan [description]', description: 'Enter plan mode' },
    { name: '/review [PR]', description: 'Review pull request' },
    { name: '/diff', description: 'View uncommitted changes' },
    { name: '/simplify [focus]', description: 'Review code quality' },
    { name: '/batch <instruction>', description: 'Parallel codebase changes' },
    { name: '/loop [interval]', description: 'Run prompt repeatedly' },
    { name: '/goal [condition]', description: 'Keep working until goal met' },
  ],
  'Config': [
    { name: '/init', description: 'Initialize project with CLAUDE.md' },
    { name: '/memory', description: 'Edit CLAUDE.md memory files' },
    { name: '/permissions', description: 'Manage tool permissions' },
    { name: '/config', description: 'Open settings UI' },
    { name: '/mcp', description: 'Manage MCP server connections' },
    { name: '/theme', description: 'Change color theme' },
    { name: '/debug [desc]', description: 'Enable debug logging' },
    { name: '/hooks', description: 'View hook configurations' },
  ],
  'Info & Utils': [
    { name: '/help', description: 'Show help' },
    { name: '/usage', description: 'Show session cost & usage' },
    { name: '/doctor', description: 'Diagnose installation' },
    { name: '/feedback [report]', description: 'Submit feedback or bug report' },
    { name: '/btw <question>', description: 'Quick side question' },
    { name: '/recap', description: 'Generate session summary' },
    { name: '/tasks', description: 'List background tasks' },
  ],
};

const KEYBOARD_SHORTCUTS: CommandEntry[] = [
  { name: 'Ctrl+C', description: 'Interrupt or clear input' },
  { name: 'Escape', description: 'Stop response mid-turn' },
  { name: 'Ctrl+D', description: 'Exit Claude Code' },
  { name: 'Ctrl+R', description: 'Reverse search history' },
  { name: 'Ctrl+O', description: 'Toggle transcript viewer' },
  { name: 'Ctrl+L', description: 'Redraw screen' },
  { name: 'Shift+Tab', description: 'Cycle permission modes' },
  { name: 'Alt+P', description: 'Switch model' },
  { name: 'Alt+T', description: 'Toggle extended thinking' },
  { name: 'Alt+O', description: 'Toggle fast mode' },
  { name: 'Ctrl+J', description: 'Newline in input' },
];

interface CommandsPanelProps {
  onSendCommand: (command: string) => void;
}

export function CommandsPanel({ onSendCommand }: CommandsPanelProps) {
  const [tab, setTab] = useState<'quick' | 'all' | 'keys'>('quick');
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
        {(['quick', 'all', 'keys'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent-purple)' : '2px solid transparent',
              backgroundColor: 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t === 'quick' ? 'Quick' : t === 'all' ? 'Commands' : 'Shortcuts'}
          </button>
        ))}
      </div>

      {tab === 'quick' && <QuickCommands onSendCommand={onSendCommand} />}

      {tab === 'all' && (
        <div>
          {Object.entries(SLASH_COMMANDS).map(([section, commands]) => (
            <div key={section} style={{ marginBottom: 4 }}>
              <button
                onClick={() =>
                  setExpandedSection(expandedSection === section ? null : section)
                }
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                {section}
                <span style={{ color: 'var(--text-muted)' }}>
                  {expandedSection === section ? '-' : '+'}
                </span>
              </button>
              {expandedSection === section && (
                <div style={{ paddingLeft: 8 }}>
                  {commands.map((cmd) => (
                    <button
                      key={cmd.name}
                      onClick={() => {
                        const base = cmd.name.split(' ')[0];
                        onSendCommand(base);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '4px 8px',
                        border: 'none',
                        backgroundColor: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        borderRadius: 4,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          'rgba(124,58,237,0.1)')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = 'transparent')
                      }
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--accent-purple-light)',
                          fontFamily: 'monospace',
                        }}
                      >
                        {cmd.name}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          marginLeft: 8,
                        }}
                      >
                        {cmd.description}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'keys' && (
        <div>
          <h3
            style={{
              marginBottom: 8,
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Keyboard Shortcuts
          </h3>
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <kbd
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  borderRadius: 3,
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                }}
              >
                {shortcut.name}
              </kbd>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {shortcut.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
