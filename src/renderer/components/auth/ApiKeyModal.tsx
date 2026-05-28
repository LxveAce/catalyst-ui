import React, { useEffect, useRef, useState } from 'react';
import type { ProviderId } from '../../../shared/types';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

const PROVIDER_KEY_URL: Record<ProviderId, string> = {
  anthropic: 'https://console.anthropic.com/account/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
};

interface Props {
  provider: ProviderId;
  /** "pre-launch" shows the standard Save & Launch button; "pty-interceptor"
   *  shows "Submit to terminal" instead — different semantics. */
  source: 'pre-launch' | 'pty-interceptor';
  onSubmit: (key: string) => void | Promise<void>;
  onDismiss: () => void;
}

export function ApiKeyModal({ provider, source, onSubmit, onDismiss }: Props) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = PROVIDER_LABEL[provider];
  const keyUrl = PROVIDER_KEY_URL[provider];

  // Track mount so a slow onSubmit can't setState after unmount and
  // produce React's "memory leak" warning. Post-Cat 5 audit fix.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async () => {
    setError(null);
    const trimmed = key.trim();
    if (!trimmed) {
      setError('Key cannot be empty.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } catch (e) {
      if (mountedRef.current) {
        setError((e as Error).message ?? String(e));
        setBusy(false);
      }
      return;
    }
    if (mountedRef.current) setBusy(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ marginBottom: 6, fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {source === 'pre-launch' ? 'Set API key' : 'CLI needs API key'}
        </div>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--text-primary)' }}>
          {label} API key
        </h3>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            margin: '0 0 12px',
          }}
        >
          {source === 'pre-launch'
            ? `Saved encrypted via your OS keychain (Electron safeStorage). The model will launch with the key in its environment.`
            : `The spawned CLI is waiting for your ${label} API key. Submit here and we'll type it into the terminal + save it for next time.`}
          {' '}
          <a
            href={keyUrl}
            onClick={(e) => {
              e.preventDefault();
              void window.electronAPI.models.openExternal(keyUrl);
            }}
            style={{ color: 'var(--accent-light)' }}
          >
            Get a key →
          </a>
        </p>

        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            provider === 'anthropic'
              ? 'sk-ant-…'
              : provider === 'openai'
                ? 'sk-…'
                : provider === 'gemini'
                  ? 'AIza…'
                  : 'sk-or-…'
          }
          autoFocus
          disabled={busy}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            fontSize: 13,
            fontFamily: 'monospace',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <div
            style={{
              marginTop: 10,
              padding: 8,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(220,38,38,0.12)',
              color: '#fca5a5',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={onDismiss}
            disabled={busy}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !key.trim()}
            style={{
              flex: 2,
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'white',
              cursor: busy || !key.trim() ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              opacity: busy || !key.trim() ? 0.6 : 1,
            }}
          >
            {busy
              ? 'Saving…'
              : source === 'pre-launch'
                ? 'Save & launch'
                : 'Submit to terminal'}
          </button>
        </div>
      </div>
    </div>
  );
}
