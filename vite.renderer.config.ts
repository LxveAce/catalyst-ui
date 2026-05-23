import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Vite config for the renderer process.
 *
 * Critical for `npm run make` to work — three things that aren't obvious:
 *
 * 1. `base: './'` so the bundled HTML uses relative asset paths. Without
 *    this, the production build emits `/assets/index-XXX.js` (root-absolute),
 *    which post-load becomes `file:///assets/...` and 404s. With it, paths
 *    resolve from the HTML's own location inside `app.asar`.
 *
 * 2. `build.outDir` pinned to `.vite/renderer/main_window` because
 *    `@electron-forge/plugin-vite` expects the renderer output at exactly
 *    `.vite/renderer/<rendererName>/` — that's where the packager pulls
 *    from, and where `loadFile(__dirname + '../renderer/<name>/index.html')`
 *    resolves to inside the packaged asar. The forge plugin tries to inject
 *    this via `mergeConfig`, but our `root: 'src/renderer'` makes Vite
 *    resolve a relative outDir from a different anchor, so we set an
 *    absolute path explicitly to defeat that interaction.
 *
 * 3. `emptyOutDir: true` so stale renderer assets from a prior build
 *    don't ride along into the new asar.
 *
 * Without these, the packaged window opens blank (renderer files missing
 * from the asar, or referenced via paths that resolve to outside the asar).
 */
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true,
  },
});
