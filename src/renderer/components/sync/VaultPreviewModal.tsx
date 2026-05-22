import React from 'react';
import type { VaultPreview } from '../../../shared/types';

interface VaultPreviewModalProps {
  preview: VaultPreview;
  onClose: () => void;
}

export function VaultPreviewModal({ preview, onClose }: VaultPreviewModalProps) {
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
          width: 480,
          maxWidth: '90vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 20,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Vault preview
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 10px',
              fontSize: 11,
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >Close</button>
        </div>

        <code style={{
          fontFamily: 'monospace',
          fontSize: 10,
          color: 'var(--accent-light)',
          marginBottom: 8,
          wordBreak: 'break-all',
        }}>
          {preview.name}
        </code>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          marginBottom: 12,
        }}>
          <Field label="Size" value={`${(preview.size / 1024).toFixed(1)} KB`} />
          <Field label="Turns" value={preview.turnCount?.toString() ?? '—'} />
          <Field label="Ctx tokens" value={preview.contextTokens?.toString() ?? '—'} />
          <Field label="Tail bytes" value={`${(preview.transcriptTailBytes / 1024).toFixed(1)} KB`} />
        </div>

        {preview.sessionId && (
          <div style={{ marginBottom: 8 }}>
            <Label>Session ID</Label>
            <code style={mono}>{preview.sessionId}</code>
          </div>
        )}
        {preview.cwd && (
          <div style={{ marginBottom: 8 }}>
            <Label>Working dir</Label>
            <code style={mono}>{preview.cwd}</code>
          </div>
        )}

        <Label>Transcript tail excerpt (first 800 chars)</Label>
        <pre style={{
          flex: 1,
          margin: 0,
          padding: 10,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-secondary)',
          fontFamily: 'monospace',
          fontSize: 10,
          lineHeight: 1.5,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {preview.transcriptTailExcerpt || '(empty)'}
        </pre>

        <div style={{
          marginTop: 10,
          padding: '6px 10px',
          fontSize: 10,
          color: 'var(--text-muted)',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          lineHeight: 1.4,
        }}>
          When sync is enabled, this whole file (not just the excerpt) is uploaded to your configured private repo.
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: '6px 8px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
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

const mono: React.CSSProperties = {
  display: 'block',
  padding: '4px 8px',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'monospace',
  fontSize: 10,
  color: 'var(--text-secondary)',
  wordBreak: 'break-all',
};
