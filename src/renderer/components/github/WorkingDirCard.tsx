import React, { useEffect, useState } from 'react';
import type { GitRepoState } from '../../../shared/types';

interface WorkingDirCardProps {
  cwd: string;
  git: GitRepoState | null;
  onPickDir: () => void;
  onSetCwd: (next: string) => void | Promise<void>;
  onRefresh: () => void;
}

export function WorkingDirCard({ cwd, git, onPickDir, onSetCwd, onRefresh }: WorkingDirCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cwd);

  useEffect(() => {
    setDraft(cwd);
  }, [cwd]);

  const found = git?.found ?? false;
  const branch = git?.branch ?? '';
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  const dirty = git?.dirty ?? false;

  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-primary)',
      border: `1px solid ${found ? 'var(--border-active)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-md)',
      marginBottom: 10,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <div style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Working Directory
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          title="Edit path"
          style={iconBtn}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button onClick={onPickDir} title="Browse" style={iconBtn}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSetCwd(draft);
            setEditing(false);
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="C:\\path\\to\\repo"
            style={inputStyle}
            autoFocus
          />
          <button type="submit" style={smallBtn}>Apply</button>
        </form>
      ) : (
        <div style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          fontFamily: 'monospace',
          wordBreak: 'break-all',
          marginBottom: found ? 8 : 0,
        }}>
          {cwd || 'No directory set'}
        </div>
      )}

      {found && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--text-secondary)',
          flexWrap: 'wrap',
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            background: 'var(--accent-dim)',
            borderRadius: 10,
            color: 'var(--accent-light)',
            fontWeight: 500,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            {branch || 'detached'}
          </span>
          {ahead > 0 && <span style={pill('#10b981')}>↑{ahead}</span>}
          {behind > 0 && <span style={pill('#f59e0b')}>↓{behind}</span>}
          {dirty ? (
            <span style={pill('#f43f5e')}>● dirty</span>
          ) : (
            <span style={pill('#6b7280')}>clean</span>
          )}
          <button
            onClick={onRefresh}
            title="Refresh git state"
            style={{ ...iconBtn, marginLeft: 'auto' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

const smallBtn: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-gradient)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 11,
  fontFamily: 'monospace',
};

function pill(color: string): React.CSSProperties {
  return {
    padding: '2px 7px',
    fontSize: 10,
    borderRadius: 10,
    background: 'var(--bg-elevated)',
    border: `1px solid ${color}40`,
    color,
    fontWeight: 500,
  };
}
