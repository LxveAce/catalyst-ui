/**
 * Standalone Vite builder for the electron-builder pipeline.
 *
 * Why this exists: @electron-forge/plugin-vite normally orchestrates Vite
 * for us, injecting entry points, output paths, and the
 * MAIN_WINDOW_VITE_DEV_SERVER_URL / MAIN_WINDOW_VITE_NAME globals at build
 * time. electron-builder doesn't do any of that — it just packages whatever
 * we hand it. So we drive Vite directly with the right injections.
 *
 * Critical: src/main/index.ts has BARE references to MAIN_WINDOW_VITE_*
 * (not inside try/catch). Without these defines those become ReferenceErrors
 * at runtime in the packaged build.
 *
 * Output layout (matches what the forge plugin produces):
 *   .vite/build/index.js     — main process bundle
 *   .vite/build/preload.js   — preload bundle
 *   .vite/renderer/main_window/index.html + assets — renderer
 *
 * Usage:
 *   node scripts/build-vite.mjs
 *
 * Dev (`npm start`) still uses electron-forge — this script is only invoked
 * by the electron-builder pipeline (npm run dist / npm run dist:dir).
 */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { builtinModules } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const defines = {
  // For prod builds these collapse to safe values matching what forge-plugin-vite
  // emits when MAIN_WINDOW_VITE_DEV_SERVER_URL is unset. The runtime takes the
  // loadFile branch (the `else` arm at index.ts:202) and the renderer dir name
  // gets substituted into the path literal.
  MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
  MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
};

// Mark EVERY Node.js built-in as external so Vite emits plain
// `require('node:path')` calls in the bundled output instead of bundling
// them as browser-shimmed modules. Without this, Vite's default target
// is `modules` (browser), and `node:path` etc. get replaced with empty
// stubs — which crashes the main process at startup with
// `TypeError: path.join is not a function`.
const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

// Production runtime deps that the main process requires at runtime —
// must NOT be bundled into the asar (they need to load from
// node_modules). node-pty has native bindings; systeminformation has
// optional native helpers; electron + electron-updater are runtime-
// provided.
const runtimeExternals = [
  'electron',
  'electron-updater',
  'electron-squirrel-startup',
  'node-pty',
  'systeminformation',
  '@octokit/rest',
];

const mainExternals = [...nodeExternals, ...runtimeExternals];

async function buildMain() {
  await build({
    configFile: path.resolve(root, 'vite.main.config.ts'),
    build: {
      // Target Node 20+ (Electron 42 uses Node 20.x) so Vite doesn't
      // try to provide browser polyfills for Node-only globals.
      target: 'node20',
      ssr: true,
      lib: {
        entry: path.resolve(root, 'src/main/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js',
      },
      outDir: path.resolve(root, '.vite/build'),
      emptyOutDir: false,
      // Electron main is small enough that the readability of unminified
      // stack traces in production logs is worth more than the few KB saved.
      minify: false,
      rollupOptions: {
        // CRITICAL: externalize all Node built-ins + our runtime deps.
        // Without this, `require('node:path')` returns a browser stub
        // and path.join etc. crash at startup.
        external: mainExternals,
      },
    },
    define: defines,
  });
}

async function buildPreload() {
  await build({
    configFile: path.resolve(root, 'vite.preload.config.ts'),
    build: {
      target: 'node20',
      ssr: true,
      lib: {
        entry: path.resolve(root, 'src/preload/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js',
      },
      outDir: path.resolve(root, '.vite/build'),
      emptyOutDir: false,
      minify: false,
      // Preload runs in a sandboxed renderer but with Node integration
      // disabled; it can still use Node built-ins through contextBridge
      // but is bundled together with browser code. Externalize Node
      // built-ins + electron to keep them as runtime requires.
      rollupOptions: {
        external: [...nodeExternals, 'electron'],
      },
    },
  });
}

async function buildRenderer() {
  // vite.renderer.config.ts already specifies root + outDir + plugins.
  await build({
    configFile: path.resolve(root, 'vite.renderer.config.ts'),
  });
}

const t0 = Date.now();
console.log('[build-vite] building main...');
await buildMain();
console.log('[build-vite] building preload...');
await buildPreload();
console.log('[build-vite] building renderer...');
await buildRenderer();
console.log(`[build-vite] complete in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
