import React, { useState } from 'react';

interface CommandDef {
  label: string;
  command: string;
  description: string;
  category: string;
}

const QUICK_COMMANDS: CommandDef[] = [
  { label: 'Opus', command: '/model opus', description: 'Switch to Claude Opus', category: 'Model' },
  { label: 'Sonnet', command: '/model sonnet', description: 'Switch to Claude Sonnet', category: 'Model' },
  { label: 'Haiku', command: '/model haiku', description: 'Switch to Claude Haiku', category: 'Model' },
  { label: 'Max Effort', command: '/effort max', description: 'Maximum reasoning effort', category: 'Effort' },
  { label: 'High Effort', command: '/effort high', description: 'High reasoning effort', category: 'Effort' },
  { label: 'Low Effort', command: '/effort low', description: 'Quick lightweight responses', category: 'Effort' },
  { label: 'Compact', command: '/compact', description: 'Free up context by summarizing', category: 'Session' },
  { label: 'Clear', command: '/clear', description: 'Start new conversation', category: 'Session' },
  { label: 'Resume', command: '/resume', description: 'Resume previous session', category: 'Session' },
  { label: 'Plan Mode', command: '/plan', description: 'Enter plan mode', category: 'Workflow' },
  { label: 'Review', command: '/review', description: 'Review pull request', category: 'Workflow' },
  { label: 'Diff', command: '/diff', description: 'View uncommitted changes', category: 'Workflow' },
  { label: 'Context', command: '/context', description: 'Visualize context usage', category: 'Info' },
  { label: 'Usage', command: '/usage', description: 'Show session cost & usage', category: 'Info' },
  { label: 'Help', command: '/help', description: 'Show help', category: 'Info' },
  { label: 'Fast Mode', command: '/fast', description: 'Toggle fast output mode', category: 'Model' },
  { label: 'Memory', command: '/memory', description: 'Edit CLAUDE.md memory files', category: 'Config' },
  { label: 'Permissions', command: '/permissions', description: 'Manage tool permissions', category: 'Config' },
  { label: 'Init', command: '/init', description: 'Initialize project with CLAUDE.md', category: 'Config' },
  { label: 'Debug', command: '/debug', description: 'Enable debug logging', category: 'Config' },
];

const CATEGORIES = ['Model', 'Effort', 'Session', 'Workflow', 'Info', 'Config'];

interface QuickCommandsProps {
  onSendCommand: (command: string) => void;
}

export function QuickCommands({ onSendCommand }: QuickCommandsProps) {
  const [activeCategory, setActiveCategory] = useState('Model');
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);

  const filteredCommands = QUICK_COMMANDS.filter(
    (c) => c.category === activeCategory
  );

  return (
    <div>
      <h3
        style={{
          marginBottom: 12,
          color: 'var(--text-primary)',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Quick Commands
      </h3>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          marginBottom: 12,
        }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              fontSize: 11,
              cursor: 'pointer',
              backgroundColor:
                activeCategory === cat
                  ? 'var(--accent-purple)'
                  : 'var(--bg-primary)',
              color:
                activeCategory === cat ? '#fff' : 'var(--text-secondary)',
              fontWeight: activeCategory === cat ? 600 : 400,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filteredCommands.map((cmd) => (
          <button
            key={cmd.command}
            onClick={() => onSendCommand(cmd.command)}
            onMouseEnter={() => setHoveredCmd(cmd.command)}
            onMouseLeave={() => setHoveredCmd(null)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 10px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              backgroundColor:
                hoveredCmd === cmd.command
                  ? 'rgba(124,58,237,0.15)'
                  : 'var(--bg-primary)',
              textAlign: 'left',
              transition: 'background-color 0.15s',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {cmd.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                }}
              >
                {cmd.description}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                color: 'var(--accent-purple-light)',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
              }}
            >
              {cmd.command}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
