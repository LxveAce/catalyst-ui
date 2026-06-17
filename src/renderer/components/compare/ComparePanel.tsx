import React, { useState, useEffect, useCallback, useRef } from 'react';

interface OllamaModel {
  name: string;
  sizeBytes: number;
}

interface CompareResult {
  model: string;
  response: string;
  durationMs: number;
  error?: string;
}

type Phase = 'idle' | 'loading' | 'done';

const BLIND_LABELS = ['Model A', 'Model B', 'Model C', 'Model D'];

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/```[\s\S]*?```/g, (m) => {
    const inner = m.slice(3, -3).replace(/^[a-z]*\n?/, '');
    return `<pre style="background:var(--bg-secondary);padding:8px;border-radius:var(--radius-sm);overflow-x:auto;font-size:12px;margin:6px 0">${escapeAttr(inner)}</pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-secondary);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}

export function ComparePanel() {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [blindMode, setBlindMode] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [results, setResults] = useState<CompareResult[]>([]);
  const runIdRef = useRef(0);

  const fetchModels = useCallback(async () => {
    try {
      setModelsError(null);
      const list: OllamaModel[] = await window.electronAPI.ollama.list();
      setModels(list);
      if (list.length === 0) {
        setModelsError('No models installed. Pull a model in the Models panel first.');
      }
    } catch {
      setModelsError('Ollama is not running or unreachable. Start Ollama to use Compare.');
      setModels([]);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const toggleModel = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else if (next.size < 4) {
        next.add(name);
      }
      return next;
    });
  }, []);

  const canRun = selected.size >= 2 && prompt.trim().length > 0;

  const handleCompare = useCallback(async () => {
    if (!canRun) return;
    const thisRun = ++runIdRef.current;
    setPhase('loading');
    setResults([]);
    setRevealed(false);
    try {
      const res: CompareResult[] = await window.electronAPI.compare.run(
        prompt.trim(),
        Array.from(selected),
      );
      if (thisRun !== runIdRef.current) return;
      setResults(res);
      setPhase('done');
    } catch {
      if (thisRun !== runIdRef.current) return;
      setResults([{
        model: '',
        response: '',
        durationMs: 0,
        error: 'Compare request failed. Is Ollama running?',
      }]);
      setPhase('done');
    }
  }, [canRun, prompt, selected]);

  const handleClear = useCallback(() => {
    setPhase('idle');
    setResults([]);
    setPrompt('');
    setRevealed(false);
  }, []);

  const orderedSelected = Array.from(selected);

  const getLabel = (model: string, idx: number): string => {
    if (!blindMode || revealed) return model;
    return BLIND_LABELS[idx] ?? `Model ${idx + 1}`;
  };

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 3, height: 14, borderRadius: 2,
          background: 'var(--accent-gradient)',
        }} />
        Blind Model Compare
      </h3>

      {modelsError && (
        <div style={{
          background: 'rgba(255,80,80,0.08)',
          border: '1px solid rgba(255,80,80,0.25)',
          borderRadius: 'var(--radius-md)',
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 14,
        }}>
          {modelsError}
        </div>
      )}

      <div style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        marginBottom: 14,
      }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter a prompt to compare across models..."
          rows={3}
          disabled={phase === 'loading'}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            outline: 'none',
            transition: 'var(--transition-fast)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border-active)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
      </div>

      <div style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>Models (select 2-4)</span>
          <span style={{ fontWeight: 400, opacity: 0.7 }}>
            {selected.size} selected
          </span>
        </div>

        {models.length === 0 && !modelsError && (
          <div style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            fontStyle: 'italic',
            padding: '6px 0',
          }}>
            Loading models...
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {models.map((m) => {
            const checked = selected.has(m.name);
            const disabled = !checked && selected.size >= 4;
            return (
              <label
                key={m.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 6px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.4 : 1,
                  background: checked ? 'var(--bg-hover)' : 'transparent',
                  transition: 'var(--transition-fast)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleModel(m.name)}
                  style={{ accentColor: 'var(--accent)', cursor: 'inherit' }}
                />
                <span style={{
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {m.name}
                </span>
                <span style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  flexShrink: 0,
                }}>
                  {formatSize(m.sizeBytes)}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={blindMode}
            onChange={() => { setBlindMode((p) => !p); setRevealed(false); }}
            style={{ accentColor: 'var(--accent)' }}
          />
          Blind Mode
        </label>

        <div style={{ flex: 1 }} />

        {phase === 'done' && (
          <button
            onClick={handleClear}
            style={{
              background: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              padding: '5px 14px',
              cursor: 'pointer',
              transition: 'var(--transition-fast)',
            }}
          >
            Clear
          </button>
        )}

        <button
          onClick={handleCompare}
          disabled={!canRun || phase === 'loading'}
          style={{
            background: canRun && phase !== 'loading'
              ? 'var(--accent-gradient)'
              : 'var(--bg-secondary)',
            color: canRun && phase !== 'loading' ? '#fff' : 'var(--text-secondary)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            fontWeight: 600,
            padding: '6px 20px',
            cursor: canRun && phase !== 'loading' ? 'pointer' : 'not-allowed',
            opacity: canRun && phase !== 'loading' ? 1 : 0.5,
            transition: 'var(--transition-fast)',
          }}
        >
          {phase === 'loading' ? 'Comparing...' : 'Compare'}
        </button>
      </div>

      {phase === 'loading' && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          {orderedSelected.map((_, idx) => (
            <div
              key={idx}
              style={{
                flex: '1 1 calc(50% - 6px)',
                minWidth: 200,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 14,
              }}
            >
              <div style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 10,
              }}>
                {getLabel('', idx)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[80, 60, 90].map((w, i) => (
                  <div
                    key={i}
                    style={{
                      height: 12,
                      width: `${w}%`,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-secondary)',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {phase === 'done' && results.length > 0 && (
        <>
          {blindMode && !revealed && (
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <button
                onClick={() => setRevealed(true)}
                style={{
                  background: 'none',
                  border: '1px solid var(--accent-dim)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '5px 18px',
                  cursor: 'pointer',
                  transition: 'var(--transition-fast)',
                }}
              >
                <svg
                  width="14" height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ verticalAlign: -2, marginRight: 5 }}
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Reveal Models
              </button>
            </div>
          )}

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            {results.map((r, idx) => (
              <div
                key={r.model + idx}
                style={{
                  flex: '1 1 calc(50% - 6px)',
                  minWidth: 200,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                  <span style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: blindMode && !revealed
                      ? 'var(--accent)'
                      : 'var(--text-primary)',
                  }}>
                    {getLabel(r.model, idx)}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                  }}>
                    {(r.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>

                {r.error ? (
                  <div style={{
                    fontSize: 12,
                    color: 'rgba(255,80,80,0.9)',
                    background: 'rgba(255,80,80,0.06)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                  }}>
                    {r.error}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: 'var(--text-primary)',
                      wordBreak: 'break-word',
                      overflow: 'auto',
                      maxHeight: 320,
                    }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(r.response) }}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.15; }
        }
      `}</style>
    </div>
  );
}
