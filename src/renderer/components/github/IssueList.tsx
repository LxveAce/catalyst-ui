import React from 'react';
import type { GitHubIssue } from '../../../shared/types';

interface IssueListProps {
  issues: GitHubIssue[] | null;
  loading: boolean;
}

export function IssueList({ issues, loading }: IssueListProps) {
  if (loading && !issues) return <Loader>Loading issues…</Loader>;
  if (!issues || issues.length === 0) return <Loader>No open issues.</Loader>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {issues.map((i) => (
        <button
          key={i.number}
          onClick={() => void window.electronAPI.github.openExternal(i.htmlUrl)}
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
            <IssueBadge state={i.state} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>#{i.number}</span>
            <span style={{
              fontSize: 11,
              color: 'var(--text-primary)',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {i.title}
            </span>
          </div>

          {i.labels.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
              {i.labels.slice(0, 4).map((l) => (
                <span
                  key={l.name}
                  style={{
                    fontSize: 9,
                    padding: '1px 6px',
                    borderRadius: 8,
                    background: `#${l.color}20`,
                    border: `1px solid #${l.color}50`,
                    color: `#${l.color}`,
                  }}
                >
                  {l.name}
                </span>
              ))}
            </div>
          )}

          <div style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}>
            {i.authorAvatarUrl && (
              <img
                src={i.authorAvatarUrl}
                alt={i.authorLogin}
                width={14}
                height={14}
                style={{ borderRadius: '50%' }}
              />
            )}
            <span>{i.authorLogin}</span>
            {i.commentCount > 0 && (
              <>
                <span>·</span>
                <span>💬 {i.commentCount}</span>
              </>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function IssueBadge({ state }: { state: string }) {
  const color = state === 'open' ? '#10b981' : '#7c3aed';
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
      {state}
    </span>
  );
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
