import React from 'react';
import type { GitHubCommit } from '../../../shared/types';

interface CommitListProps {
  commits: GitHubCommit[] | null;
  loading: boolean;
}

export function CommitList({ commits, loading }: CommitListProps) {
  if (loading && !commits) return <Loader>Loading commits…</Loader>;
  if (!commits || commits.length === 0) return <Loader>No commits to show.</Loader>;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      {commits.map((c) => (
        <button
          key={c.sha}
          onClick={() => void window.electronAPI.github.openExternal(c.htmlUrl)}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
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
          {c.authorAvatarUrl ? (
            <img
              src={c.authorAvatarUrl}
              alt={c.authorLogin ?? c.authorName}
              width={20}
              height={20}
              style={{ borderRadius: '50%', flexShrink: 0, marginTop: 1 }}
            />
          ) : (
            <div style={avatarFallback}>{(c.authorLogin ?? c.authorName).slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {c.message}
            </div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 6,
              marginTop: 2,
            }}>
              <code style={shaStyle}>{c.shortSha}</code>
              <span>{c.authorLogin ?? c.authorName}</span>
              <span>·</span>
              <span>{formatRelative(c.date)}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

const avatarFallback: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: 'var(--accent-dim)',
  color: 'var(--accent-light)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  fontWeight: 600,
  flexShrink: 0,
};

const shaStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  padding: '1px 5px',
  background: 'var(--bg-elevated)',
  borderRadius: 4,
  color: 'var(--accent-light)',
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

function formatRelative(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
