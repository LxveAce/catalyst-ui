import React from 'react';
import type { GitHubPullRequest } from '../../../shared/types';

interface PRListProps {
  prs: GitHubPullRequest[] | null;
  loading: boolean;
}

export function PRList({ prs, loading }: PRListProps) {
  if (loading && !prs) return <Loader>Loading pull requests…</Loader>;
  if (!prs || prs.length === 0) return <Loader>No open pull requests.</Loader>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {prs.map((pr) => (
        <button
          key={pr.number}
          onClick={() => void window.electronAPI.github.openExternal(pr.htmlUrl)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            padding: '8px 10px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'border-color var(--transition-fast)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-active)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          title="Open on GitHub"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <PRBadge draft={pr.draft} merged={pr.merged} state={pr.state} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>#{pr.number}</span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {pr.title}
            </span>
          </div>
          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}>
            {pr.authorAvatarUrl && (
              <img
                src={pr.authorAvatarUrl}
                alt={pr.authorLogin}
                width={14}
                height={14}
                style={{ borderRadius: '50%' }}
              />
            )}
            <span>{pr.authorLogin}</span>
            <span>·</span>
            <code style={refStyle}>{pr.headRef}</code>
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <code style={refStyle}>{pr.baseRef}</code>
            {pr.commentCount > 0 && (
              <>
                <span>·</span>
                <span>💬 {pr.commentCount}</span>
              </>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function PRBadge({ draft, merged, state }: { draft: boolean; merged: boolean; state: string }) {
  let color = '#10b981';
  let label = 'open';
  if (merged) {
    color = '#7c3aed';
    label = 'merged';
  } else if (state === 'closed') {
    color = '#f43f5e';
    label = 'closed';
  } else if (draft) {
    color = '#6b7280';
    label = 'draft';
  }
  return (
    <span style={{
      fontSize: 9,
      padding: '2px 6px',
      borderRadius: 8,
      background: `${color}20`,
      color,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    }}>
      {label}
    </span>
  );
}

const refStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  padding: '1px 5px',
  background: 'var(--bg-elevated)',
  borderRadius: 4,
  color: 'var(--text-secondary)',
  fontSize: 9,
};

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
