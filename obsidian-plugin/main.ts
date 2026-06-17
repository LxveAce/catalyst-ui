import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

/**
 * Catalyst Brain Bridge — first-party Obsidian plugin (P5).
 *
 * The legally-clean "Brain shows up inside Obsidian too" piece (built on the
 * MIT `obsidian` type stubs — the stubs are MIT even though the Obsidian app
 * is not). It does NOT embed or redistribute Catalyst; it's a small companion
 * the user installs in their own vault.
 *
 * What it does today (all via the public Obsidian API, no network):
 *   - A command + ribbon to tag the active note with `catalyst_brain: true` in
 *     frontmatter, so Catalyst's mirror/index can prioritize it.
 *   - A status-bar item showing how many notes are Catalyst-tagged.
 *   - A settings tab noting the shared Brain folder.
 *
 * Catalyst reads/writes the same `.md` folder directly (its Brain Folder
 * Service), so this plugin and Catalyst cooperate purely through the files —
 * no inbound server needed. A future version can call Catalyst's own endpoint
 * once one exists.
 */

interface CatalystBridgeSettings {
  /** Informational: the folder Catalyst points its Brain at (this vault). */
  brainFolderNote: string;
}

const DEFAULT_SETTINGS: CatalystBridgeSettings = {
  brainFolderNote: '',
};

const TAG_KEY = 'catalyst_brain';

export default class CatalystBrainBridge extends Plugin {
  settings: CatalystBridgeSettings = DEFAULT_SETTINGS;
  private statusEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon('brain-circuit', 'Tag note for Catalyst Brain', () => {
      void this.tagActiveNote();
    });

    this.addCommand({
      id: 'catalyst-tag-note',
      name: 'Tag active note for Catalyst Brain',
      callback: () => void this.tagActiveNote(),
    });

    this.addCommand({
      id: 'catalyst-untag-note',
      name: 'Remove Catalyst Brain tag from active note',
      callback: () => void this.tagActiveNote(false),
    });

    this.statusEl = this.addStatusBarItem();
    this.updateStatus();
    this.registerEvent(this.app.metadataCache.on('changed', () => this.updateStatus()));

    this.addSettingTab(new CatalystBridgeSettingTab(this.app, this));
    new Notice('Catalyst Brain Bridge loaded');
  }

  private async tagActiveNote(on = true): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') {
      new Notice('Open a Markdown note first.');
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (on) fm[TAG_KEY] = true;
      else delete fm[TAG_KEY];
    });
    new Notice(on ? 'Tagged for Catalyst Brain.' : 'Removed Catalyst Brain tag.');
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    let count = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && fm[TAG_KEY]) count++;
    }
    this.statusEl.setText(`🧠 Catalyst: ${count}`);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class CatalystBridgeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CatalystBrainBridge) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h3', { text: 'Catalyst Brain Bridge' });
    containerEl.createEl('p', {
      text:
        'Catalyst UI reads and writes this vault folder directly as its "Brain". ' +
        'This plugin cooperates through the files — tag notes here and Catalyst ' +
        'will see the tag. No data leaves your machine.',
    });

    new Setting(containerEl)
      .setName('Brain folder (note)')
      .setDesc('Optional reminder of which folder you pointed Catalyst at.')
      .addText((t) =>
        t
          .setPlaceholder('e.g. this vault root')
          .setValue(this.plugin.settings.brainFolderNote)
          .onChange(async (v) => {
            this.plugin.settings.brainFolderNote = v;
            await this.plugin.saveSettings();
          })
      );
  }
}
