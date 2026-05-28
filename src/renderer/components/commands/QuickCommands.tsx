import React, { useEffect, useState } from 'react';
import type { CommandDef } from './command-families';

interface QuickCommandsProps {
  /** Now accepts an optional submit flag. CommandsPanel forwards each
   *  CommandDef's `submit` field (default true) so starter commands
   *  land in the composer without auto-submitting an empty argument. */
  onSendCommand: (command: string, submit?: boolean) => void;
  /** Commands to render, grouped by `category`. */
  commands: CommandDef[];
  /** Pill order. Categories not present in `commands` collapse to empty. */
  categories: string[];
  /** Optional message rendered when `commands` is empty. */
  emptyMessage?: string;
}

export function QuickCommands({
  onSendCommand,
  commands,
  categories,
  emptyMessage,
}: QuickCommandsProps) {
  // Track the active category as renderer state, but reset it whenever the
  // family changes (categories array identity flips) so we don't end up
  // pointing at a category the new family doesn't have.
  const [activeCategory, setActiveCategory] = useState<string>(
    categories[0] ?? ''
  );
  const [hoveredCmd, setHoveredCmd] = useState<string | null>(null);

  useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory(categories[0] ?? '');
    }
  }, [categories, activeCategory]);

  if (commands.length === 0) {
    return (
      <div
        style={{
          padding: '20px 12px',
          background: 'var(--bg-primary)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--text-muted)',
          textAlign: 'center',
        }}
      >
        {emptyMessage ?? 'No quick commands for this profile.'}
      </div>
    );
  }

  const filtered = commands.filter((c) => c.category === activeCategory);

  return (
    <div>
      {/* Category Pills */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        marginBottom: 12,
      }}>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-xl)',
              border: activeCategory === cat ? 'none' : '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              background: activeCategory === cat ? 'var(--accent-gradient)' : 'transparent',
              color: activeCategory === cat ? '#fff' : 'var(--text-secondary)',
              transition: 'all var(--transition-fast)',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Commands List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.map((cmd) => {
          const isHovered = hoveredCmd === cmd.command;
          return (
            <button
              key={cmd.command}
              onClick={() => onSendCommand(cmd.command, cmd.submit !== false)}
              onMouseEnter={() => setHoveredCmd(cmd.command)}
              onMouseLeave={() => setHoveredCmd(null)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${isHovered ? 'var(--border-active)' : 'var(--border)'}`,
                cursor: 'pointer',
                background: isHovered ? 'var(--accent-gradient-soft)' : 'var(--bg-primary)',
                textAlign: 'left',
                transition: 'all var(--transition-fast)',
                transform: isHovered ? 'translateX(2px)' : 'none',
              }}
            >
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}>
                  {cmd.label}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 1,
                }}>
                  {cmd.description}
                </div>
              </div>
              <span style={{
                fontSize: 11,
                color: 'var(--accent-light)',
                fontFamily: 'monospace',
                whiteSpace: 'nowrap',
                opacity: isHovered ? 1 : 0.6,
                transition: 'opacity var(--transition-fast)',
              }}>
                {cmd.command}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
