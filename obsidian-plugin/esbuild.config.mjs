import esbuild from 'esbuild';

const production = process.argv[2] === 'production';

const ctx = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  // Obsidian + Electron + CodeMirror are provided by the host at runtime.
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', 'node:*'],
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
