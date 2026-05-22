import React, { useCallback, useEffect, useState } from 'react';
import type {
  LocalVault,
  RemoteVault,
  SyncSettings,
  SyncStatus,
  VaultPreview,
} from '../../../shared/types';
import { SyncWizard } from './SyncWizard';
import { VaultPreviewModal } from './VaultPreviewModal';

export function SyncPanel() {
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [local, setLocal] = useState<LocalVault[] | null>(null);
  const [remote, setRemote] = useState<RemoteVault[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [previewing, setPreviewing] = useState<VaultPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, st, lv] = await Promise.all([
        window.electronAPI.sync.getSettings(),
        window.electronAPI.sync.status(),
        window.electronAPI.sync.listLocal(),
      ]);
      setSettings(s);
      setStatus(st);
      setLocal(lv);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load sync state');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async () => {
    if (!settings || !status) return;
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (!settings.enabled && !status.configured) {
        setWizardOpen(true);
        return;
      }
      const next = await window.electronAPI.sync.setSettings({ enabled: !settings.enabled });
      setSettings(next);
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Toggle failed');
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const next = await window.electronAPI.sync.syncNow();
      setStatus(next);
      await refresh();
      setInfo(next.lastError ? `Sync errored: ${next.lastError}` : 'Sync complete.');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const handleListRemote = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await window.electronAPI.sync.listRemote();
      setRemote(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not list remote');
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = async (name: string) => {
    const p = await window.electronAPI.sync.previewVault(name);
    if (p) setPreviewing(p);
    else setErr(`Could not preview ${name}`);
  };

  const handleWizardComplete = async () => {
    setWizardOpen(false);
    await refresh();
    setInfo('Setup complete. Toggle Active above to start syncing.');
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={headerStyle}>
        <div style={accentBar} />
        Cloud Sync
      </h3>

      {settings && status && (
        <ToggleCard
          enabled={settings.enabled}
          configured={status.configured}
          ghConnected={status.ghConnected}
          ghScopeOk={status.ghScopeOk}
          ghScopes={status.ghScopes}
          onToggle={handleToggle}
          onSetup={() => setWizardOpen(true)}
          disabled={busy}
        />
      )}

      {status && (
        <StatsRow status={status} settings={settings} />
      )}

      {status?.lastError && (
        <Banner color="#fda4af" bg="rgba(244,63,94,0.08)" border="rgba(244,63,94,0.3)">
          Last sync: {status.lastError}
        </Banner>
      )}

      {settings?.enabled && status?.configured && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button onClick={handleSyncNow} disabled={busy} style={primaryBtn}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
          <button onClick={handleListRemote} disabled={busy} style={secondaryBtn}>
            View remote
          </button>
        </div>
      )}

      {err && <Banner color="#fda4af" bg="rgba(244,63,94,0.08)" border="rgba(244,63,94,0.3)">{err}</Banner>}
      {info && <Banner color="#86efac" bg="rgba(16,185,129,0.08)" border="rgba(16,185,129,0.3)">{info}</Banner>}

      <LocalVaultList vaults={local} onPreview={handlePreview} />

      {remote && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>Remote ({settings?.owner ?? ''})</SectionLabel>
          {remote.length === 0 ? (
            <Empty>No remote vaults for this device yet.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {remote.map((r) => (
                <div key={r.path} style={rowStyle}>
                  <code style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {r.name}
                  </code>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatBytes(r.size)}</span>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Delete ${r.name} from GitHub? Note: it stays in git history.`)) return;
                      try {
                        await window.electronAPI.sync.deleteRemote(r.name);
                        setRemote(remote.filter((x) => x.path !== r.path));
                        setInfo(`Deleted ${r.name} (still in git history).`);
                      } catch (e: unknown) {
                        setErr(e instanceof Error ? e.message : 'Delete failed');
                      }
                    }}
                    title="Delete remote vault"
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {wizardOpen && settings && (
        <SyncWizard
          initial={settings}
          ghConnected={!!status?.ghConnected}
          ghScopeOk={!!status?.ghScopeOk}
          onCancel={() => setWizardOpen(false)}
          onComplete={handleWizardComplete}
        />
      )}

      {previewing && (
        <VaultPreviewModal
          preview={previewing}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  );
}

function ToggleCard({
  enabled,
  configured,
  ghConnected,
  ghScopeOk,
  ghScopes,
  onToggle,
  onSetup,
  disabled,
}: {
  enabled: boolean;
  configured: boolean;
  ghConnected: boolean;
  ghScopeOk: boolean;
  ghScopes: string[];
  onToggle: () => void;
  onSetup: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <div style={{
        padding: '14px 16px',
        background: enabled ? 'var(--accent-gradient-soft)' : 'var(--bg-primary)',
        border: `1px solid ${enabled ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        transition: 'all var(--transition-base)',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {enabled ? 'Active' : configured ? 'Inactive' : 'Not configured'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Vault → private GitHub repo
          </div>
        </div>
        <button
          onClick={onToggle}
          disabled={disabled}
          style={{
            width: 44, height: 24, borderRadius: 12, border: 'none', padding: 2,
            cursor: disabled ? 'wait' : 'pointer',
            background: enabled ? 'var(--accent)' : 'var(--gauge-grey)',
            transition: 'background var(--transition-base)',
            position: 'relative', flexShrink: 0,
          }}
        >
          <div style={{
            width: 20, height: 20, borderRadius: '50%', background: '#fff',
            transition: 'transform var(--transition-base)',
            transform: `translateX(${enabled ? 20 : 0}px)`,
            boxShadow: 'var(--shadow-sm)',
          }} />
        </button>
      </div>

      {!ghConnected && (
        <Banner color="#fcd34d" bg="rgba(245,158,11,0.08)" border="rgba(245,158,11,0.3)">
          GitHub not connected. Add a PAT in the GitHub panel first.
        </Banner>
      )}
      {ghConnected && !ghScopeOk && (
        <Banner color="#fcd34d" bg="rgba(245,158,11,0.08)" border="rgba(245,158,11,0.3)">
          Your PAT needs the <code style={code}>repo</code> scope to write to a private repo.
          Current: <code style={code}>{ghScopes.join(', ') || '(none)'}</code>. Regenerate it in the GitHub panel.
        </Banner>
      )}
      {!configured && ghConnected && ghScopeOk && (
        <button onClick={onSetup} style={{ ...primaryBtn, width: '100%', marginBottom: 10 }}>
          Set up vault sync
        </button>
      )}
    </>
  );
}

function StatsRow({ status, settings }: { status: SyncStatus; settings: SyncSettings | null }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 6,
      marginBottom: 10,
    }}>
      <Stat label="Local vaults" value={String(status.localVaultCount)} />
      <Stat label="Pushed" value={`${status.pushedCount} / ${status.localVaultCount}`} />
      <Stat label="Pending" value={String(status.pendingCount)} accent={status.pendingCount > 0} />
      <Stat
        label="Last sync"
        value={status.lastSyncAt ? formatRelative(status.lastSyncAt) : 'never'}
      />
      {settings?.owner && settings?.repo && (
        <div style={{
          gridColumn: '1 / -1',
          padding: '6px 10px',
          fontSize: 10,
          color: 'var(--text-muted)',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {settings.owner}/{settings.repo} · device: {settings.deviceName} · branch: {settings.branch}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 14,
        fontWeight: 700,
        color: accent ? 'var(--accent-light)' : 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function LocalVaultList({
  vaults,
  onPreview,
}: {
  vaults: LocalVault[] | null;
  onPreview: (name: string) => void;
}) {
  if (!vaults) return null;
  if (vaults.length === 0) {
    return (
      <div style={{ marginTop: 8 }}>
        <SectionLabel>Local vaults</SectionLabel>
        <Empty>
          No vaults yet. They appear automatically when compact-controller runs.
        </Empty>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <SectionLabel>Local vaults ({vaults.length})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {vaults.slice(0, 10).map((v) => (
          <button
            key={v.name}
            onClick={() => onPreview(v.name)}
            style={{ ...rowStyle, cursor: 'pointer', textAlign: 'left', width: '100%' }}
            title="Preview before upload"
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: v.pushed ? '#10b981' : '#6b7280',
              flexShrink: 0,
            }} />
            <code style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {v.name}
            </code>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatBytes(v.size)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      marginBottom: 4,
    }}>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-muted)',
      fontSize: 11,
      textAlign: 'center',
    }}>{children}</div>
  );
}

function Banner({
  children, color, bg, border,
}: {
  children: React.ReactNode; color: string; bg: string; border: string;
}) {
  return (
    <div style={{
      marginBottom: 10,
      padding: '8px 10px',
      fontSize: 11,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 'var(--radius-md)',
      color,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
  marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
};
const accentBar: React.CSSProperties = {
  width: 3, height: 14, borderRadius: 2, background: 'var(--accent-gradient)',
};
const primaryBtn: React.CSSProperties = {
  flex: 1, padding: '7px 10px', border: 'none',
  borderRadius: 'var(--radius-sm)', background: 'var(--accent-gradient)',
  color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  flex: 1, padding: '7px 10px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '6px 10px', background: 'var(--bg-primary)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
};
const code: React.CSSProperties = {
  fontFamily: 'monospace', padding: '0 4px',
  background: 'var(--bg-elevated)', borderRadius: 3,
  color: 'var(--accent-light)',
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(1)}MB`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
