import React, { useState } from 'react';

interface ConnectGitHubProps {
  onConnect: (token: string, allowPlaintext?: boolean) => Promise<void>;
  encryptionAvailable: boolean;
}

export function ConnectGitHub({ onConnect, encryptionAvailable }: ConnectGitHubProps) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allowPlaintext, setAllowPlaintext] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    if (!encryptionAvailable && !allowPlaintext) {
      setErr(
        'OS keychain is unavailable on this system. Tick "Store in plaintext anyway" to acknowledge that the token will be written unencrypted, or unlock your keychain and try again.'
      );
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConnect(token.trim(), allowPlaintext);
      setToken('');
      setAllowPlaintext(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to validate token');
    } finally {
      setBusy(false);
    }
  };

  const openTokenPage = () => {
    void window.electronAPI.github.openExternal(
      'https://github.com/settings/tokens/new?scopes=public_repo&description=Claude%20Code%20Studio'
    );
  };

  return (
    <div style={{
      marginTop: 10,
      padding: '14px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 6,
      }}>
        Connect GitHub
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>
        Paste a Personal Access Token to fetch repo, commit, PR, and issue data.
        {encryptionAvailable ? (
          <> Token is encrypted via the OS keychain (DPAPI on Windows).</>
        ) : (
          <>
            {' '}
            <strong style={{ color: '#fda4af' }}>
              OS keychain unavailable on this system — token would be stored as plaintext.
            </strong>
          </>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ghp_…"
          autoComplete="off"
          style={{
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 11,
            fontFamily: 'monospace',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="submit"
            disabled={busy || !token.trim()}
            style={{
              flex: 1,
              padding: '7px 10px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: token.trim() && !busy ? 'var(--accent-gradient)' : 'var(--bg-elevated)',
              color: token.trim() && !busy ? '#fff' : 'var(--text-muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: busy ? 'wait' : token.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? 'Validating…' : 'Connect'}
          </button>
          <button
            type="button"
            onClick={openTokenPage}
            style={{
              padding: '7px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Generate token ↗
          </button>
        </div>
      </form>

      {err && (
        <div style={{
          marginTop: 8,
          padding: '6px 8px',
          fontSize: 10,
          color: '#fda4af',
          background: 'rgba(244,63,94,0.08)',
          border: '1px solid rgba(244,63,94,0.3)',
          borderRadius: 'var(--radius-sm)',
        }}>
          {err}
        </div>
      )}

      {!encryptionAvailable && (
        <label style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          color: '#fda4af',
          cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={allowPlaintext}
            onChange={(e) => setAllowPlaintext(e.target.checked)}
          />
          Store in plaintext anyway (I accept the risk)
        </label>
      )}

      <div style={{
        marginTop: 8,
        fontSize: 10,
        color: 'var(--text-muted)',
        lineHeight: 1.5,
      }}>
        Default scope: <code style={codeStyle}>public_repo</code>. For private repos,
        use a fine-grained PAT scoped to just the repos you want to browse.
      </div>
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  padding: '1px 5px',
  background: 'var(--bg-elevated)',
  borderRadius: 4,
  color: 'var(--accent-light)',
};
