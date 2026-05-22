import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PublisherGithub } from '@electron-forge/publisher-github';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Claude Code Studio',
    // executableName must match what auto-update expects post-install.
    // Squirrel uses the productName for the install dir; this controls the .exe.
    executableName: 'claude-code-studio',
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      // Required for Squirrel auto-update: the friendly name shown in
      // Programs & Features and used by update.electronjs.org for matching.
      name: 'claude_code_studio',
      authors: 'LxveAce',
      description:
        'Full desktop GUI for Claude Code with resource monitoring and cloud sync',
      // --- Branding hooks (uncomment + provide assets to enable) -----------
      // setupIcon: './assets/installer.ico',
      //   Path to a multi-resolution .ico (16/32/48/256). NSIS-style installer
      //   icon; falls back to Electron default if omitted.
      // loadingGif: './assets/loading.gif',
      //   Animated GIF shown during install (recommended 640x480, <2MB).
      //   Adds polish; cosmetic only.
      // iconUrl:
      //   'https://raw.githubusercontent.com/LxveAce/claude-code-studio/master/assets/app-icon.ico',
      //   Public HTTPS URL Squirrel fetches at first install for the
      //   Programs & Features icon. MUST be public; CDN-hosted is fine.
      // --- Code signing (Windows) ------------------------------------------
      // certificateFile: process.env.WINDOWS_CERT_PATH,
      // certificatePassword: process.env.WINDOWS_CERT_PASSWORD,
      //   Required for SmartScreen reputation. Use an EV or OV cert.
      //   Without signing: first-run installer triggers SmartScreen warning,
      //   but auto-update still functions (Squirrel does NOT require signing
      //   to apply update deltas, unlike macOS).
      // signWithParams: '/tr http://timestamp.digicert.com /td sha256 /fd sha256',
      //   Timestamping is required so signatures survive cert expiry.
    }),
    new MakerZIP({}, ['darwin']),
  ],
  publishers: [
    // GitHub Releases publisher — `npm run publish` will draft a release
    // and upload Squirrel artifacts. update-electron-app reads from this
    // same release feed at runtime.
    //
    // Auth: requires GITHUB_TOKEN env var with `repo` scope at publish time.
    // We do NOT bake any token into source — publish is a manual maintainer
    // action, not a CI step (yet).
    new PublisherGithub({
      repository: {
        owner: 'LxveAce',
        name: 'claude-code-studio',
      },
      // Draft releases so the maintainer can review release notes before
      // exposing them to update.electronjs.org's release feed.
      draft: true,
      // prerelease: false by default — flip per-publish via env if shipping
      // to a beta channel. Beta channel UX is exposed in Settings but the
      // actual feed routing is set here at publish time.
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
    }),
  ],
};

export default config;
