import React, { useEffect, useMemo, useState } from 'react';
import { deriveThemeFromAccent, type ThemePreset } from '../../theme-presets';
import type { CustomTheme } from '../../../shared/types';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAME_MAX = 40;

interface Props {
  /** Currently saved customs — refresh after save/delete. */
  initialThemes: CustomTheme[];
  /** Apply a theme to the live app chrome without saving. */
  onLivePreview: (preset: ThemePreset) => void;
  /** Restore the user's previously active theme on close-without-save. */
  onRestoreActiveTheme: () => void;
  /** Persist the chosen theme and apply it as the active theme. */
  onSaveAndApply: (theme: CustomTheme) => void;
  /** Remove a saved custom theme by name. */
  onDelete: (name: string) => void;
  /** Dismiss without changes. */
  onClose: () => void;
}

export function ThemeEditor({
  initialThemes,
  onLivePreview,
  onRestoreActiveTheme,
  onSaveAndApply,
  onDelete,
  onClose,
}: Props) {
  const [name, setName] = useState('Custom');
  const [accent, setAccent] = useState('#7c3aed');
  const [accentLight, setAccentLight] = useState('#a78bfa');
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo<ThemePreset>(
    () => deriveThemeFromAccent(name || 'Preview', accent, accentLight),
    [name, accent, accentLight]
  );

  // Push live preview to the app chrome so the user sees the result on the
  // real surfaces, not just inside the modal swatch. Restore on unmount.
  useEffect(() => {
    onLivePreview(preview);
  }, [preview, onLivePreview]);

  // Capture the latest `onRestoreActiveTheme` in a ref so the unmount
  // cleanup always calls the current callback even if the parent
  // re-renders with a new closure. Avoids the "stale callback on
  // unmount" foot-gun the original empty-deps useEffect had.
  const restoreRef = React.useRef(onRestoreActiveTheme);
  useEffect(() => {
    restoreRef.current = onRestoreActiveTheme;
  }, [onRestoreActiveTheme]);
  useEffect(() => {
    return () => {
      restoreRef.current();
    };
  }, []);

  const handleSave = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name required');
      return;
    }
    if (trimmed.length > NAME_MAX) {
      setError(`Name must be under ${NAME_MAX} characters`);
      return;
    }
    if (!HEX_RE.test(accent)) {
      setError('Accent must be a #rrggbb hex (e.g. #7c3aed)');
      return;
    }
    if (!HEX_RE.test(accentLight)) {
      setError('Accent light must be a #rrggbb hex (e.g. #a78bfa)');
      return;
    }
    const built = deriveThemeFromAccent(trimmed, accent, accentLight);
    const toSave: CustomTheme = {
      name: built.name,
      accent: built.accent,
      accentLight: built.accentLight,
      gradient: built.gradient,
      gradientSoft: built.gradientSoft,
      borderActive: built.borderActive,
      glow: built.glow,
    };
    onSaveAndApply(toSave);
  };

  const handleEditExisting = (t: CustomTheme) => {
    setName(t.name);
    setAccent(t.accent);
    setAccentLight(t.accentLight);
    setError(null);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>
            Theme editor
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>

        {/* Editor row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 12 }}>Accent</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                style={swatchStyle}
              />
              <input
                type="text"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>

            <label style={{ ...labelStyle, marginTop: 12 }}>Accent light</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={accentLight}
                onChange={(e) => setAccentLight(e.target.value)}
                style={swatchStyle}
              />
              <input
                type="text"
                value={accentLight}
                onChange={(e) => setAccentLight(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>

            {error && (
              <div
                style={{
                  marginTop: 12,
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

            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 16,
              }}
            >
              <button onClick={handleSave} style={primaryButton(accent)}>
                Save & apply
              </button>
            </div>
          </div>

          {/* Live preview pane */}
          <div>
            <label style={labelStyle}>Preview</label>
            <div
              style={{
                marginTop: 4,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                background: 'var(--bg-secondary)',
              }}
            >
              <div
                style={{
                  height: 40,
                  background: preview.gradient,
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: 12,
                  color: 'white',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Gradient header
              </div>
              <div style={{ padding: 12 }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${preview.borderActive}`,
                    background: preview.gradientSoft,
                    boxShadow: preview.glow,
                    color: preview.accentLight,
                    fontSize: 12,
                  }}
                >
                  Sample button
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Existing customs */}
        {initialThemes.length > 0 && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 8,
              }}
            >
              Your custom themes ({initialThemes.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {initialThemes.map((t) => (
                <div
                  key={t.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      background: t.gradient,
                      borderRadius: 4,
                      flexShrink: 0,
                    }}
                  />
                  <button
                    onClick={() => handleEditExisting(t)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: 0,
                    }}
                  >
                    {t.name}
                  </button>
                  <button
                    onClick={() => onDelete(t.name)}
                    title={`Delete ${t.name}`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 14,
                      padding: '0 4px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const swatchStyle: React.CSSProperties = {
  width: 36,
  height: 28,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
};

function primaryButton(accent: string): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px 14px',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${accent}`,
    background: accent,
    color: 'white',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  };
}
