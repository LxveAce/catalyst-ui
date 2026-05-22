import React, { useEffect, useState } from 'react';

interface StatusBarProps {
  pid: number;
}

export function StatusBar({ pid }: StatusBarProps) {
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Poll once at mount for already-pending updates (e.g. user re-opens
    // Settings/StatusBar after the update fired earlier this session).
    void (async () => {
      try {
        const state = await window.electronAPI.updater.getState();
        if (!cancelled) setPendingVersion(state.pendingVersion);
      } catch {
        // updater may not be ready yet — ignore
      }
    })();
    const unsub = window.electronAPI.updater.onAvailable((version) => {
      if (!cancelled) setPendingVersion(version || 'new');
    });
    return () => {
      cancelled = true;
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <div style={{
      height: 28,
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      fontSize: 11,
      color: 'var(--text-muted)',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: pid > 0 ? 'var(--success)' : 'var(--danger)',
            boxShadow: pid > 0 ? '0 0 6px rgba(34,197,94,0.4)' : '0 0 6px rgba(239,68,68,0.4)',
          }} />
          <span>{pid > 0 ? 'Connected' : 'Disconnected'}</span>
        </div>
        {pid > 0 && (
          <span style={{ color: 'var(--text-muted)' }}>
            PID {pid}
          </span>
        )}
        {pendingVersion && (
          <span
            title={`Version ${pendingVersion} will install on next launch`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 8px',
              borderRadius: 10,
              background: 'var(--accent-dim)',
              color: 'var(--accent-light)',
              fontWeight: 500,
              fontSize: 10,
            }}
          >
            <span style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--accent-light)',
            }} />
            Update v{pendingVersion} ready
          </span>
        )}
      </div>
      <span>Claude Code Studio v1.0.0</span>
    </div>
  );
}
