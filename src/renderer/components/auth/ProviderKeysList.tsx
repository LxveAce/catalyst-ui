import React, { useEffect, useState } from 'react';
import type { AuthSource, ProviderAuthEntry, ProviderId } from '../../../shared/types';
import { ApiKeyModal } from './ApiKeyModal';

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

const PROVIDER_BLURB: Record<ProviderId, string> = {
  anthropic: 'Claude CLI uses this when set; otherwise falls back to OAuth login.',
  openai: 'Aider + OpenRouter + any tool that reads OPENAI_API_KEY.',
  gemini: 'Google gemini-cli.',
  openrouter: 'OpenAI-compat aggregator. Used by Aider with --openai-api-base.',
};

export function ProviderKeysList() {
  const [entries, setEntries] = useState<ProviderAuthEntry[]>([]);
  const [editFor, setEditFor] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const next = await window.electronAPI.providerAuth.list();
      setEntries(next);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onSubmit = (provider: ProviderId) => async (key: string) => {
    setBusy(true);
    try {
      const next = await window.electronAPI.providerAuth.setKey(provider, key);
      setEntries(next);
      setEditFor(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (provider: ProviderId) => {
    setBusy(true);
    try {
      const next = await window.electronAPI.providerAuth.delete(provider);
      setEntries(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}
      >
        API keys
      </div>

      <p
        style={{
          fontSize: 11,
          color: 'var(--text-secondary)',
          margin: '0 0 12px',
          lineHeight: 1.5,
        }}
      >
        Keys are encrypted via your OS keychain (Electron safeStorage) and
        injected as environment variables when launching the matching model.
        Raw keys never leave the main process.
      </p>

      {error && (
        <div
          style={{
            padding: 8,
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(220,38,38,0.12)',
            color: '#fca5a5',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entries.map((entry) => {
          // Build a status line that reflects the auto-detect source so the
          // user sees "already authenticated via Claude CLI" / "env var
          // detected" instead of a false "not set" when the CLI is wired up
          // independently. Source ranking: stored > cli-oauth > env > none.
          const sourceTag = sourceLabel(entry.source);
          const lastWord = entry.hasKey
            ? `set ${formatRelative(entry.lastUpdated)}`
            : entry.source === 'cli-oauth'
              ? 'authenticated via Claude CLI'
              : entry.source === 'env'
                ? 'env var detected'
                : 'not set';
          // No need to prompt for a key when an env var or CLI OAuth is
          // already in place — the spawned PTY inherits it. We still
          // expose "Set" so power users can override.
          const buttonLabel = entry.hasKey
            ? 'Replace'
            : entry.source === 'none'
              ? 'Set'
              : 'Override';
          return (
            <div
              key={entry.provider}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '8px 10px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {PROVIDER_LABEL[entry.provider]}
                  {sourceTag && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: sourceTag.bg,
                        color: sourceTag.fg,
                      }}
                    >
                      {sourceTag.text}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {PROVIDER_BLURB[entry.provider]} · {lastWord}
                </div>
              </div>
              <button
                onClick={() => setEditFor(entry.provider)}
                disabled={busy}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  borderRadius: 'var(--radius-md)',
                  padding: '4px 10px',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                }}
              >
                {buttonLabel}
              </button>
              {entry.hasKey && (
                <button
                  onClick={() => void onDelete(entry.provider)}
                  disabled={busy}
                  title={`Delete ${PROVIDER_LABEL[entry.provider]} key`}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 8px',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {editFor && (
        <ApiKeyModal
          provider={editFor}
          source="pre-launch"
          onSubmit={onSubmit(editFor)}
          onDismiss={() => setEditFor(null)}
        />
      )}
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Small colored tag rendered next to the provider name when auth was
 *  auto-detected from somewhere other than our own safeStorage. */
function sourceLabel(
  s: AuthSource
): { text: string; bg: string; fg: string } | null {
  switch (s) {
    case 'cli-oauth':
      return {
        text: 'CLI OAuth',
        bg: 'rgba(134,239,172,0.18)',
        fg: '#86efac',
      };
    case 'env':
      return { text: 'env var', bg: 'rgba(147,197,253,0.18)', fg: '#93c5fd' };
    case 'stored':
      return { text: 'saved', bg: 'rgba(124,58,237,0.22)', fg: '#a78bfa' };
    case 'none':
    default:
      return null;
  }
}
