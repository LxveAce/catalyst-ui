import React from 'react';
import type { GitHubBranch } from '../../../shared/types';

interface BranchListProps {
  branches: GitHubBranch[] | null;
  loading: boolean;
}

export function BranchList({ branches, loading }: BranchListProps) {
  if (loading && !branches) return <Loader>Loading branches…</Loader>;
  if (!branches || branches.length === 0) return <Loader>No branches to show.</Loader>;

  const sorted = [...branches].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sorted.map((b) => (
        <div
          key={b.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            background: 'var(--bg-primary)',
            border: `1px solid ${b.isDefault ? 'var(--border-active)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span style={{
              fontSize: 11,
              color: 'var(--text-primary)',
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {b.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {b.isDefault && (
              <span style={tag('var(--accent-light)')}>default</span>
            )}
            {b.protected && (
              <span style={tag('#f59e0b')}>protected</span>
            )}
            <code style={shaStyle}>{b.sha.slice(0, 7)}</code>
          </div>
        </div>
      ))}
    </div>
  );
}

const shaStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  padding: '1px 5px',
  background: 'var(--bg-elevated)',
  borderRadius: 4,
  color: 'var(--text-muted)',
  fontSize: 9,
};

function tag(color: string): React.CSSProperties {
  return {
    fontSize: 9,
    padding: '2px 6px',
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    border: `1px solid ${color}40`,
    color,
    fontWeight: 500,
  };
}

function Loader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '14px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-muted)',
      fontSize: 11,
      textAlign: 'center',
    }}>
      {children}
    </div>
  );
}
