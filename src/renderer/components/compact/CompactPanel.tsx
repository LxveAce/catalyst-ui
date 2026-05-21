import React, { useEffect, useState, useCallback } from 'react';
import type { CompactStatus, CompactConfig } from '../../../shared/types';

export function CompactPanel() {
  const [status, setStatus] = useState<CompactStatus | null>(null);
  const [config, setConfig] = useState<CompactConfig | null>(null);
  const [toggling, setToggling] = useState(false);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([
      window.electronAPI.compact.getStatus(),
      window.electronAPI.compact.getConfig(),
    ]);
    setStatus(s);
    setConfig(c);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    if (status.enabled) {
      await window.electronAPI.compact.uninstall();
    } else {
      await window.electronAPI.compact.install();
    }
    await refresh();
    setToggling(false);
  };

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div>
      <h3
        style={{
          marginBottom: 16,
          color: 'var(--text-primary)',
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Compact Optimization
      </h3>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          {status?.enabled ? 'Active' : 'Inactive'}
        </span>
        <button
          onClick={handleToggle}
          disabled={toggling}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: toggling ? 'wait' : 'pointer',
            backgroundColor: status?.enabled
              ? 'rgba(239,68,68,0.2)'
              : 'var(--accent-purple)',
            color: status?.enabled ? '#f87171' : '#fff',
          }}
        >
          {toggling ? '...' : status?.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      {status && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            marginBottom: 16,
          }}
        >
          <StatBox label="Input Tokens" value={formatTokens(status.inputTokens)} />
          <StatBox label="Output Tokens" value={formatTokens(status.outputTokens)} />
          <StatBox label="Turns" value={String(status.turnCount)} />
          <StatBox label="Vaults" value={String(status.vaultCount)} />
        </div>
      )}

      {status?.sessionId && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginBottom: 12,
            wordBreak: 'break-all',
          }}
        >
          Session: {status.sessionId.slice(0, 16)}...
        </div>
      )}

      {config && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: 4, color: 'var(--text-primary)', fontWeight: 600 }}>
            Config
          </div>
          <div>Max vaults: {config.vault_max_entries}</div>
          <div>
            Transcript tail:{' '}
            {(config.vault_transcript_tail_bytes / 1024).toFixed(0)} KB
          </div>
          <div>Logging: {config.log_enabled ? 'On' : 'Off'}</div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-primary)',
        borderRadius: 6,
        padding: '8px 10px',
        textAlign: 'center',
      }}
    >
      <div
        style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-purple-light)' }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
