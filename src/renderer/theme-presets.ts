export interface ThemePreset {
  name: string;
  accent: string;
  accentLight: string;
  gradient: string;
  gradientSoft: string;
  borderActive: string;
  glow: string;
  /** Marks user-defined themes loaded from <userData>/themes.json. */
  custom?: boolean;
}

export interface ThemeExtras {
  density: "compact" | "comfortable" | "spacious";
  fontFamily: "system" | "mono" | "inter" | "fira";
  bgPattern: "none" | "dots" | "grid" | "rain" | "particles";
  bgIntensity: number;
  frostedGlass: boolean;
}

export const DEFAULT_THEME_EXTRAS: ThemeExtras = {
  density: "comfortable", fontFamily: "system", bgPattern: "none", bgIntensity: 30, frostedGlass: false,
};

export const THEME_PRESETS: ThemePreset[] = [
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
  {
    name: 'Slate',
    accent: '#64748b',
    accentLight: '#cbd5e1',
    gradient: 'linear-gradient(135deg, #64748b 0%, #475569 50%, #334155 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(100,116,139,0.2) 0%, rgba(71,85,105,0.1) 100%)',
    borderActive: 'rgba(100, 116, 139, 0.3)',
    glow: '0 0 20px rgba(100, 116, 139, 0.15)',
  },
  {
    name: 'Indigo',
    accent: '#6366f1',
    accentLight: '#a5b4fc',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #4338ca 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(79,70,229,0.1) 100%)',
    borderActive: 'rgba(99, 102, 241, 0.3)',
    glow: '0 0 20px rgba(99, 102, 241, 0.15)',
  },
  {
    name: 'Crimson',
    accent: '#dc2626',
    accentLight: '#fca5a5',
    gradient: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 50%, #991b1b 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(220,38,38,0.2) 0%, rgba(185,28,28,0.1) 100%)',
    borderActive: 'rgba(220, 38, 38, 0.3)',
    glow: '0 0 20px rgba(220, 38, 38, 0.15)',
  },
  {
    name: 'Forest',
    accent: '#16a34a',
    accentLight: '#86efac',
    gradient: 'linear-gradient(135deg, #16a34a 0%, #15803d 50%, #166534 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(22,163,74,0.2) 0%, rgba(21,128,61,0.1) 100%)',
    borderActive: 'rgba(22, 163, 74, 0.3)',
    glow: '0 0 20px rgba(22, 163, 74, 0.15)',
  },
  {
    name: 'Magenta',
    accent: '#d946ef',
    accentLight: '#f0abfc',
    gradient: 'linear-gradient(135deg, #d946ef 0%, #c026d3 50%, #a21caf 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(217,70,239,0.2) 0%, rgba(192,38,211,0.1) 100%)',
    borderActive: 'rgba(217, 70, 239, 0.3)',
    glow: '0 0 20px rgba(217, 70, 239, 0.15)',
  },
  {
    name: 'Midnight',
    accent: '#1e40af',
    accentLight: '#60a5fa',
    gradient: 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 50%, #172554 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(30,64,175,0.2) 0%, rgba(30,58,138,0.1) 100%)',
    borderActive: 'rgba(30, 64, 175, 0.3)',
    glow: '0 0 20px rgba(30, 64, 175, 0.15)',
  },
  {
    name: 'Solarized',
    accent: '#b58900',
    accentLight: '#eee8d5',
    gradient: 'linear-gradient(135deg, #b58900 0%, #93770a 50%, #6c5807 100%)',
    gradientSoft: 'linear-gradient(135deg, rgba(181,137,0,0.2) 0%, rgba(147,119,10,0.1) 100%)',
    borderActive: 'rgba(181, 137, 0, 0.3)',
    glow: '0 0 20px rgba(181, 137, 0, 0.15)',
  },
];

/**
 * Build a complete ThemePreset from just an accent + (optional) accent-light hex.
 * Used by the ThemeEditor — users only pick the two anchor colors; gradient,
 * glow, and border are derived. Same shape as the curated built-ins above.
 */
export function deriveThemeFromAccent(name: string, accent: string, accentLight?: string): ThemePreset {
  const light = accentLight ?? lighten(accent, 0.4);
  const mid = darken(accent, 0.1);
  const deep = darken(accent, 0.25);
  const rgb = hexToRgb(accent);
  return {
    name,
    accent,
    accentLight: light,
    gradient: `linear-gradient(135deg, ${accent} 0%, ${mid} 50%, ${deep} 100%)`,
    gradientSoft: `linear-gradient(135deg, rgba(${rgb},0.2) 0%, rgba(${rgb},0.1) 100%)`,
    borderActive: `rgba(${rgb}, 0.3)`,
    glow: `0 0 20px rgba(${rgb}, 0.15)`,
    custom: true,
  };
}

export function applyTheme(preset: ThemePreset): void {
  const root = document.documentElement;
  const rgb = hexToRgb(preset.accent);
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-light', preset.accentLight);
  root.style.setProperty('--accent-gradient', preset.gradient);
  root.style.setProperty('--accent-gradient-soft', preset.gradientSoft);
  root.style.setProperty('--border-active', preset.borderActive);
  root.style.setProperty('--shadow-glow', preset.glow);
  root.style.setProperty('--accent-dim', `rgba(${rgb}, 0.15)`);
  root.style.setProperty('--gauge-purple', preset.accent);
  root.style.setProperty('--bg-hover', `rgba(${rgb}, 0.08)`);
  // Persist with a `custom:` prefix for user themes so restore can route to
  // the right lookup (built-ins by name, customs through theme-service IPC).
  const key = preset.custom ? `custom:${preset.name}` : preset.name;
  localStorage.setItem('claude-studio-theme', key);
}

export function findThemePreset(name: string | null): ThemePreset | undefined {
  if (!name) return undefined;
  // Custom themes are loaded async via IPC; this lookup only resolves built-ins.
  // Callers needing customs must check the theme-service result.
  if (name.startsWith('custom:')) return undefined;
  return THEME_PRESETS.find((p) => p.name === name);
}

/** Strip the `custom:` prefix from a stored theme key, if present. */
export function parseThemeKey(stored: string | null): { custom: boolean; name: string } | null {
  if (!stored) return null;
  if (stored.startsWith('custom:')) {
    return { custom: true, name: stored.slice('custom:'.length) };
  }
  return { custom: false, name: stored };
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Mix the color toward white by `amount` (0–1). */
function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const k = clamp01(amount);
  const nr = Math.round(r + (255 - r) * k);
  const ng = Math.round(g + (255 - g) * k);
  const nb = Math.round(b + (255 - b) * k);
  return `#${[nr, ng, nb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Mix the color toward black by `amount` (0–1). */
function darken(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const k = clamp01(amount);
  const nr = Math.round(r * (1 - k));
  const ng = Math.round(g * (1 - k));
  const nb = Math.round(b * (1 - k));
  return `#${[nr, ng, nb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const DENSITY_MAP: Record<ThemeExtras['density'], { padding: number; gap: number; fontSize: number }> = {
  compact: { padding: 6, gap: 4, fontSize: 12 },
  comfortable: { padding: 10, gap: 8, fontSize: 13 },
  spacious: { padding: 14, gap: 12, fontSize: 14 },
};

const FONT_FAMILY_MAP: Record<ThemeExtras['fontFamily'], string> = {
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
  inter: "'Inter', system-ui, sans-serif",
  fira: "'Fira Code', monospace",
};

const THEME_EXTRAS_KEY = 'catalyst-theme-extras';

export function applyThemeExtras(extras: ThemeExtras): void {
  const root = document.documentElement;
  const d = DENSITY_MAP[extras.density] ?? DENSITY_MAP.comfortable;
  root.style.setProperty('--density-padding', `${d.padding}px`);
  root.style.setProperty('--density-gap', `${d.gap}px`);
  root.style.setProperty('--density-font-size', `${d.fontSize}px`);
  document.body.style.fontFamily = FONT_FAMILY_MAP[extras.fontFamily] ?? FONT_FAMILY_MAP.system;
  if (extras.frostedGlass) {
    document.body.classList.add('frosted-glass');
  } else {
    document.body.classList.remove('frosted-glass');
  }
}

export function loadThemeExtras(): ThemeExtras {
  try {
    const raw = localStorage.getItem(THEME_EXTRAS_KEY);
    if (!raw) return { ...DEFAULT_THEME_EXTRAS };
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      ['compact', 'comfortable', 'spacious'].includes(parsed.density) &&
      ['system', 'mono', 'inter', 'fira'].includes(parsed.fontFamily) &&
      ['none', 'dots', 'grid', 'rain', 'particles'].includes(parsed.bgPattern) &&
      typeof parsed.bgIntensity === 'number' && parsed.bgIntensity >= 0 && parsed.bgIntensity <= 100 &&
      typeof parsed.frostedGlass === 'boolean'
    ) {
      return parsed as ThemeExtras;
    }
    return { ...DEFAULT_THEME_EXTRAS };
  } catch {
    return { ...DEFAULT_THEME_EXTRAS };
  }
}

export function saveThemeExtras(extras: ThemeExtras): void {
  localStorage.setItem(THEME_EXTRAS_KEY, JSON.stringify(extras));
  window.dispatchEvent(new Event('theme-extras-changed'));
}
