import React from 'react';
import type { GitHubRepoInfo } from '../../../shared/types';

interface RepoHeaderProps {
  info: GitHubRepoInfo | null;
  loading: boolean;
}

export function RepoHeader({ info, loading }: RepoHeaderProps) {
  if (loading && !info) return <Skeleton />;
  if (!info) return <Empty>Repo info not loaded yet.</Empty>;

  return (
    <div style={{
      padding: '14px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <button
          onClick={() => void window.electronAPI.github.openExternal(info.htmlUrl)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--accent-light)',
            textAlign: 'left',
          }}
          title="Open on GitHub"
        >
          {info.fullName}
        </button>
        {info.isPrivate && (
          <span style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Private
          </span>
        )}
      </div>

      {info.description && (
        <div style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          marginBottom: 10,
        }}>
          {info.description}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <Stat label="★" value={info.stars} />
        <Stat label="⑂" value={info.forks} />
        <Stat label="issues" value={info.openIssues} />
        {info.language && <Stat label="" value={info.language} accent />}
      </div>

      {info.topics.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
          {info.topics.map((t) => (
            <span key={t} style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'var(--accent-dim)',
              color: 'var(--accent-light)',
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      <div style={{
        fontSize: 10,
        color: 'var(--text-muted)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>default: <code style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{info.defaultBranch}</code></span>
        <span>updated {formatDate(info.updatedAt)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <span style={{
      fontSize: 11,
      padding: '3px 8px',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      color: accent ? 'var(--accent-light)' : 'var(--text-secondary)',
      fontWeight: 500,
      display: 'inline-flex',
      gap: 4,
      alignItems: 'center',
    }}>
      {label && <span style={{ color: 'var(--text-muted)' }}>{label}</span>}
      <span>{value}</span>
    </span>
  );
}

function Skeleton() {
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
      Loading repo…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}
