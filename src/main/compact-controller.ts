import * as crypto from 'node:crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CompactStatus, CompactConfig } from '../shared/types';

const STATE_DIR = path.join(os.homedir(), '.claude', 'compact-controller');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const CONFIG_FILE = path.join(
  os.homedir(),
  'claude-compact-controller',
  'config.json'
);
const VAULT_DIR = path.join(STATE_DIR, 'vault');
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');

interface SettingsJson {
  hooks?: Record<string, Array<{ type?: string; command?: string; matcher?: string }>>;
  [key: string]: unknown;
}

interface StateJson {
  session_id?: string;
  input_tokens?: number;
  output_tokens?: number;
  turn_count?: number;
  [key: string]: unknown;
}

export class CompactController {
  getStatus(): CompactStatus {
    const enabled = this.isEnabled();
    const state = this.readState();
    const vaults = this.listVaults();

    return {
      enabled,
      sessionId: state?.session_id ?? null,
      inputTokens: state?.input_tokens ?? 0,
      outputTokens: state?.output_tokens ?? 0,
      turnCount: state?.turn_count ?? 0,
      vaultCount: vaults.length,
      lastVaultFile: vaults.length > 0 ? vaults[vaults.length - 1] : null,
    };
  }

  getConfig(): CompactConfig {
    try {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return {
        vault_max_entries: 10,
        vault_transcript_tail_bytes: 50000,
        log_enabled: false,
      };
    }
  }

  setConfig(config: Partial<CompactConfig>): CompactConfig {
    const current = this.getConfig();
    const merged = { ...current, ...config };
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    // Atomic write via tmp + rename. The original direct writeFileSync
    // could truncate this shared-with-claude-compact-controller config
    // if Node crashed mid-serialization. The same atomic pattern already
    // protects writeSettings() (line 202) where the blast radius is the
    // user's whole ~/.claude/settings.json.
    const tmp = `${CONFIG_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, CONFIG_FILE);
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
      throw e;
    }
    return merged;
  }

  install(): boolean {
    try {
      const settings = this.readSettings();
      const hooksDir = path.join(
        os.homedir(),
        'claude-compact-controller',
        'hooks'
      );

      if (!fs.existsSync(hooksDir)) return false;

      const hookDefs = [
        {
          event: 'Stop',
          script: path.join(hooksDir, 'stop-hook.js').replace(/\\/g, '/'),
        },
        {
          event: 'PreCompact',
          script: path.join(hooksDir, 'pre-compact.js').replace(/\\/g, '/'),
          matcher: 'auto',
        },
        {
          event: 'PostCompact',
          script: path.join(hooksDir, 'post-compact.js').replace(/\\/g, '/'),
          matcher: 'auto',
        },
      ];

      if (!settings.hooks) settings.hooks = {};

      for (const def of hookDefs) {
        if (!settings.hooks[def.event]) settings.hooks[def.event] = [];

        const exists = settings.hooks[def.event].some(
          (h) => h.command && this.isOurHookCommand(h.command)
        );
        if (exists) continue;

        const hook: { type: string; command: string; matcher?: string } = {
          type: 'command',
          command: `node "${def.script}"`,
        };
        if (def.matcher) hook.matcher = def.matcher;
        settings.hooks[def.event].push(hook);
      }

      this.writeSettings(settings);
      return true;
    } catch {
      return false;
    }
  }

  uninstall(): boolean {
    try {
      const settings = this.readSettings();
      if (!settings.hooks) return true;

      for (const event of ['Stop', 'PreCompact', 'PostCompact']) {
        if (settings.hooks[event]) {
          settings.hooks[event] = settings.hooks[event].filter(
            (h) => !h.command || !this.isOurHookCommand(h.command)
          );
          if (settings.hooks[event].length === 0) {
            delete settings.hooks[event];
          }
        }
      }

      this.writeSettings(settings);
      return true;
    } catch {
      return false;
    }
  }

  private isEnabled(): boolean {
    try {
      const settings = this.readSettings();
      if (!settings.hooks) return false;

      return ['Stop', 'PreCompact', 'PostCompact'].every((event) =>
        settings.hooks?.[event]?.some(
          (h) => h.command && this.isOurHookCommand(h.command)
        )
      );
    } catch {
      return false;
    }
  }

  private readState(): StateJson | null {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      return null;
    }
  }

  private listVaults(): string[] {
    try {
      return fs
        .readdirSync(VAULT_DIR)
        .filter((f) => f.startsWith('vault-') && f.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }

  private isOurHookCommand(command: string): boolean {
    const ourHooksRoot = path
      .join(os.homedir(), 'claude-compact-controller', 'hooks')
      .replace(/\\/g, '/');
    return command.replace(/\\/g, '/').includes(ourHooksRoot);
  }

  private readSettings(): SettingsJson {
    let raw: string;
    try {
      raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Refusing to modify ${SETTINGS_FILE}: file exists but is not valid JSON (${(e as Error).message}). ` +
          `Fix the file manually or back it up before installing.`
      );
    }
  }

  private writeSettings(settings: SettingsJson): void {
    if (fs.existsSync(SETTINGS_FILE)) {
      const backup = SETTINGS_FILE + '.bak';
      try {
        fs.copyFileSync(SETTINGS_FILE, backup);
      } catch {
        // best-effort backup; don't block the write
      }
    }
    const tmpFile = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2));
    fs.renameSync(tmpFile, SETTINGS_FILE);
  }
}
