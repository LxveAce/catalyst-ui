import React, { useState } from 'react';
import type { SyncSettings } from '../../../shared/types';

type Step = 'choose' | 'create' | 'existing' | 'consent' | 'done';

interface SyncWizardProps {
  initial: SyncSettings;
  ghConnected: boolean;
  ghScopeOk: boolean;
  onCancel: () => void;
  onComplete: () => void;
}

export function SyncWizard({ initial, ghConnected, ghScopeOk, onCancel, onComplete }: SyncWizardProps) {
  const [step, setStep] = useState<Step>('choose');
  const [repoName, setRepoName] = useState('claude-conversation-vaults');
  const [existingOwner, setExistingOwner] = useState('');
  const [existingRepo, setExistingRepo] = useState('');
  const [deviceName, setDeviceName] = useState(initial.deviceName);
  const [chosenOwner, setChosenOwner] = useState<string | null>(null);
  const [chosenRepo, setChosenRepo] = useState<string | null>(null);
  const [consentAck, setConsentAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!ghConnected || !ghScopeOk) {
    return (
      <Modal onClose={onCancel}>
        <h3 style={modalTitle}>Vault sync setup</h3>
        <div style={modalBody}>
          {!ghConnected
            ? 'Connect GitHub first in the GitHub panel.'
            : 'Your PAT needs the repo scope. Regenerate it in the GitHub panel.'}
        </div>
        <button onClick={onCancel} style={btnPrimary}>Close</button>
      </Modal>
    );
  }

  const handleCreate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const created = await window.electronAPI.sync.createRepo(repoName);
      setChosenOwner(created.owner);
      setChosenRepo(created.name);
      setStep('consent');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not create repo');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyExisting = async () => {
    setBusy(true);
    setErr(null);
    try {
      await window.electronAPI.sync.verifyRepo(existingOwner, existingRepo);
      setChosenOwner(existingOwner);
      setChosenRepo(existingRepo);
      setStep('consent');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Verify failed');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!chosenOwner || !chosenRepo || !consentAck) return;
    setBusy(true);
    setErr(null);
    try {
      await window.electronAPI.sync.setSettings({
        owner: chosenOwner,
        repo: chosenRepo,
        deviceName,
        consentAt: new Date().toISOString(),
      });
      setStep('done');
      onComplete();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onCancel}>
      <h3 style={modalTitle}>Vault sync setup</h3>
      <StepDots step={step} />

      {step === 'choose' && (
        <div>
          <p style={modalBody}>Where should vault backups go?</p>
          <button onClick={() => setStep('create')} style={btnPrimary}>
            Create new private repo
          </button>
          <button onClick={() => setStep('existing')} style={{ ...btnSecondary, marginTop: 6 }}>
            Use an existing private repo
          </button>
        </div>
      )}

      {step === 'create' && (
        <div>
          <p style={modalBody}>The repo will be created as <strong>private</strong> on your account.</p>
          <label style={fieldLabel}>Repo name</label>
          <input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            style={inputStyle}
            placeholder="claude-conversation-vaults"
          />
          {err && <ErrBanner>{err}</ErrBanner>}
          <ButtonRow>
            <button onClick={() => setStep('choose')} style={btnGhost}>Back</button>
            <button onClick={handleCreate} disabled={busy || !repoName} style={btnPrimary}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </ButtonRow>
        </div>
      )}

      {step === 'existing' && (
        <div>
          <p style={modalBody}>
            Must be <strong>private</strong>. You can verify at github.com.
          </p>
          <label style={fieldLabel}>Owner</label>
          <input
            value={existingOwner}
            onChange={(e) => setExistingOwner(e.target.value)}
            style={inputStyle}
            placeholder="your-username"
          />
          <label style={{ ...fieldLabel, marginTop: 8 }}>Repo name</label>
          <input
            value={existingRepo}
            onChange={(e) => setExistingRepo(e.target.value)}
            style={inputStyle}
            placeholder="claude-vaults"
          />
          {err && <ErrBanner>{err}</ErrBanner>}
          <ButtonRow>
            <button onClick={() => setStep('choose')} style={btnGhost}>Back</button>
            <button onClick={handleVerifyExisting} disabled={busy || !existingOwner || !existingRepo} style={btnPrimary}>
              {busy ? 'Verifying…' : 'Verify'}
            </button>
          </ButtonRow>
        </div>
      )}

      {step === 'consent' && chosenOwner && chosenRepo && (
        <div>
          <div style={{
            padding: 12,
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#fcd34d',
            fontSize: 11,
            lineHeight: 1.5,
            marginBottom: 12,
          }}>
            <strong>Heads-up:</strong> vault files contain transcript tails (the last ~50KB of
            your conversation with Claude). They may include file paths, code, or anything else
            you pasted into chat. Uploading them — even to a private GitHub repo — means
            they're stored on GitHub's servers.
            <div style={{ marginTop: 6 }}>
              <strong>Uploads are append-only.</strong> Pruning local vaults does NOT delete
              the remote copies, and even deleting them in the GitHub UI leaves them in the
              repo's git history. You can delete remote vaults from the panel, but for
              full removal you'd need to rewrite history or delete the repo.
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <div>→ <code style={code}>{chosenOwner}/{chosenRepo}</code></div>
            <div style={{ marginTop: 4 }}>Files will be pushed to <code style={code}>{deviceName}/vault-*.json</code></div>
          </div>

          <label style={fieldLabel}>Device name</label>
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            style={inputStyle}
          />

          <label style={{
            marginTop: 12,
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            fontSize: 11,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            lineHeight: 1.4,
          }}>
            <input
              type="checkbox"
              checked={consentAck}
              onChange={(e) => setConsentAck(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            I understand my vault files will be uploaded to <code style={code}>{chosenOwner}/{chosenRepo}</code> on github.com.
          </label>

          {err && <ErrBanner>{err}</ErrBanner>}
          <ButtonRow>
            <button onClick={() => setStep('choose')} style={btnGhost}>Back</button>
            <button onClick={handleConfirm} disabled={busy || !consentAck} style={btnPrimary}>
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </ButtonRow>
        </div>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Setup complete.</div>
        </div>
      )}
    </Modal>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ['choose', 'create', 'consent'];
  const idx = step === 'existing' ? 1 : order.indexOf(step);
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 12, justifyContent: 'center' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 28, height: 3, borderRadius: 2,
          background: i <= idx ? 'var(--accent)' : 'var(--border)',
        }} />
      ))}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '90vw',
          padding: 20,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>{children}</div>
  );
}

function ErrBanner({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 8,
      padding: '6px 10px',
      fontSize: 10,
      background: 'rgba(244,63,94,0.08)',
      border: '1px solid rgba(244,63,94,0.3)',
      borderRadius: 'var(--radius-sm)',
      color: '#fda4af',
    }}>{children}</div>
  );
}

const modalTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-primary)',
  marginBottom: 8,
};
const modalBody: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginBottom: 10,
  lineHeight: 1.5,
};
const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: 'var(--text-muted)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 11,
};
const btnPrimary: React.CSSProperties = {
  flex: 1,
  padding: '8px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--accent-gradient)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
};
const btnSecondary: React.CSSProperties = {
  ...btnPrimary,
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
};
const btnGhost: React.CSSProperties = {
  flex: 1,
  padding: '8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
};
const code: React.CSSProperties = {
  fontFamily: 'monospace',
  padding: '0 4px',
  background: 'var(--bg-elevated)',
  borderRadius: 3,
  color: 'var(--accent-light)',
};
