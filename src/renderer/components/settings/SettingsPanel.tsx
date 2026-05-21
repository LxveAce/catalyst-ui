import React, { useState, useEffect } from 'react';

interface ThemePreset {
  name: string;
  accent: string;
  accentLight: string;
  gradient: string;
  gradientSoft: string;
  borderActive: string;
  glow: string;
}

const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Purple',
    accent: '#7c3aed',
    accentLight: '#a78bfa',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(109,40,217,0.1) 100%)',
    borderActive: 'rgba(124, 58, 237, 0.3)',
    glow: '0 0 20px rgba(124, 58, 237, 0.15)',
  },
  {
    name: 'Blue',
    accent: '#3b82f6',
    accentLight: '#93c5fd',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(37,99,235,0.1) 100%)',
    borderActive: 'rgba(59, 130, 246, 0.3)',
    glow: '0 0 20px rgba(59, 130, 246, 0.15)',
  },
  {
    name: 'Emerald',
    accent: '#10b981',
    accentLight: '#6ee7b7',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(5,150,105,0.1) 100%)',
    borderActive: 'rgba(16, 185, 129, 0.3)',
    glow: '0 0 20px rgba(16, 185, 129, 0.15)',
  },
  {
    name: 'Rose',
    accent: '#f43f5e',
    accentLight: '#fda4af',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 50%, #be123c 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(244,63,94,0.2) 0%, rgba(225,29,72,0.1) 100%)',
    borderActive: 'rgba(244, 63, 94, 0.3)',
    glow: '0 0 20px rgba(244, 63, 94, 0.15)',
  },
  {
    name: 'Amber',
    accent: '#f59e0b',
    accentLight: '#fcd34d',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(217,119,6,0.1) 100%)',
    borderActive: 'rgba(245, 158, 11, 0.3)',
    glow: '0 0 20px rgba(245, 158, 11, 0.15)',
  },
  {
    name: 'Cyan',
    accent: '#06b6d4',
    accentLight: '#67e8f9',
    gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 50%, #0e7490 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(6,182,212,0.2) 0%, rgba(8,145,178,0.1) 100%)',
    borderActive: 'rgba(6, 182, 212, 0.3)',
    glow: '0 0 20px rgba(6, 182, 212, 0.15)',
  },
];

function applyTheme(preset: ThemePreset) {
  const root = document.documentElement;
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-light', preset.accentLight);
  root.style.setProperty('--accent-gradient', preset.gradient);
  root.style.setProperty('--accent-gradient-soft', preset.gradientSoft);
  root.style.setProperty('--border-active', preset.borderActive);
  root.style.setProperty('--shadow-glow', preset.glow);
  root.style.setProperty('--accent-dim', preset.gradientSoft.includes('rgba')
    ? `rgba(${hexToRgb(preset.accent)}, 0.15)`
    : preset.gradientSoft);
  root.style.setProperty('--gauge-purple', preset.accent);
  root.style.setProperty('--bg-hover', `rgba(${hexToRgb(preset.accent)}, 0.08)`);
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export function SettingsPanel() {
  const [activeTheme, setActiveTheme] = useState('Purple');
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('claude-studio-theme');
    if (saved) {
      const preset = THEME_PRESETS.find((p) => p.name === saved);
      if (preset) {
        setActiveTheme(saved);
        applyTheme(preset);
      }
    }
  }, []);

  const handleThemeChange = (preset: ThemePreset) => {
    setActiveTheme(preset.name);
    applyTheme(preset);
    localStorage.setItem('claude-studio-theme', preset.name);
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
        Settings
      </h3>

      {/* Accent Color */}
      <div style={{
        marginBottom: 20,
      }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Accent Color
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}>
          {THEME_PRESETS.map((preset) => {
            const isActive = activeTheme === preset.name;
            const isHovered = hoveredTheme === preset.name;
            return (
              <button
                key={preset.name}
                onClick={() => handleThemeChange(preset)}
                onMouseEnter={() => setHoveredTheme(preset.name)}
                onMouseLeave={() => setHoveredTheme(null)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: `1.5px solid ${isActive ? preset.accent : isHovered ? 'rgba(255,255,255,0.1)' : 'var(--border)'}`,
                  background: isActive
                    ? `linear-gradient(135deg, rgba(${hexToRgb(preset.accent)},0.15) 0%, rgba(${hexToRgb(preset.accent)},0.05) 100%)`
                    : 'var(--bg-primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  transition: 'all var(--transition-fast)',
                  transform: isHovered ? 'scale(1.02)' : 'none',
                }}
              >
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  background: preset.gradient,
                  boxShadow: isActive ? `0 0 12px rgba(${hexToRgb(preset.accent)},0.4)` : 'none',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span style={{
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  {preset.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal Settings */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>
          Terminal
        </div>
        <SettingRow label="Font Size" value="14px" />
        <SettingRow label="Scrollback" value="10,000 lines" />
        <SettingRow label="Cursor Style" value="Bar" />
        <SettingRow label="Cursor Blink" value="On" />
      </div>

      {/* About */}
      <div style={{
        padding: '14px 16px',
        background: 'var(--bg-primary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          About
        </div>
        <SettingRow label="App Version" value="1.0.0" />
        <SettingRow label="Electron" value="42.2.0" />
        <SettingRow label="React" value="19.x" />
        <SettingRow label="Author" value="LxveAce" />
      </div>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      padding: '5px 0',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}
