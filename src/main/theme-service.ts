import { app } from 'electron';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CustomTheme } from '../shared/types';

const STORE_FILE = 'themes.json';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const NAME_MAX = 40;
const MAX_THEMES = 64;

export class ThemeService {
  private storePath: string;
  private themes: CustomTheme[];

  constructor() {
    this.storePath = path.join(app.getPath('userData'), STORE_FILE);
    this.themes = this.read();
  }

  list(): CustomTheme[] {
    return this.themes.map((t) => ({ ...t }));
  }

  save(theme: CustomTheme): CustomTheme[] {
    const validated = this.validate(theme);
    const next = this.themes.filter((t) => t.name !== validated.name);
    if (next.length >= MAX_THEMES) {
      throw new Error(`Custom theme limit reached (${MAX_THEMES})`);
    }
    next.push(validated);
    this.themes = next;
    this.write();
    return this.list();
  }

  delete(name: string): CustomTheme[] {
    if (typeof name !== 'string') throw new Error('name must be a string');
    this.themes = this.themes.filter((t) => t.name !== name);
    this.write();
    return this.list();
  }

  private validate(t: CustomTheme): CustomTheme {
    if (typeof t.name !== 'string' || t.name.length === 0 || t.name.length > NAME_MAX) {
      throw new Error(`name must be a non-empty string under ${NAME_MAX} chars`);
    }
    // Disallow `custom:` literal prefix collisions and pure whitespace.
    if (t.name.trim() !== t.name || t.name.includes('\n')) {
      throw new Error('name cannot have leading/trailing whitespace or newlines');
    }
    if (!HEX_RE.test(t.accent)) throw new Error('accent must be a #rrggbb hex');
    if (!HEX_RE.test(t.accentLight)) throw new Error('accentLight must be a #rrggbb hex');
    if (typeof t.gradient !== 'string' || t.gradient.length > 200) {
      throw new Error('gradient must be a string under 200 chars');
    }
    if (typeof t.gradientSoft !== 'string' || t.gradientSoft.length > 200) {
      throw new Error('gradientSoft must be a string under 200 chars');
    }
    if (typeof t.borderActive !== 'string' || t.borderActive.length > 80) {
      throw new Error('borderActive must be a string under 80 chars');
    }
    if (typeof t.glow !== 'string' || t.glow.length > 80) {
      throw new Error('glow must be a string under 80 chars');
    }
    return {
      name: t.name,
      accent: t.accent,
      accentLight: t.accentLight,
      gradient: t.gradient,
      gradientSoft: t.gradientSoft,
      borderActive: t.borderActive,
      glow: t.glow,
    };
  }

  private read(): CustomTheme[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.storePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const valid: CustomTheme[] = [];
    for (const entry of parsed.slice(0, MAX_THEMES)) {
      try {
        valid.push(this.validate(entry as CustomTheme));
      } catch {
        // Skip malformed entries silently; user can re-save.
      }
    }
    return valid;
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.themes, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.storePath);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
  }
}
