const fs = require('fs');
const path = require('path');

// node-pty's Windows backend uses winpty + conpty, both of which have a
// gyp build path that runs cmd.exe + batch files during configure. Those
// fail on macOS/Linux (no cmd.exe, different shell tooling). On POSIX
// platforms node-pty uses forkpty directly — no patches needed.
if (process.platform !== 'win32') {
  console.log('[patch-node-pty] non-Windows platform — skipping (only winpty/conpty need patching)');
  process.exit(0);
}

const nodeModules = path.join(__dirname, '..', 'node_modules', 'node-pty');

if (!fs.existsSync(nodeModules)) {
  console.log('[patch-node-pty] node-pty not installed, skipping');
  process.exit(0);
}

// 1. Patch winpty.gyp: replace cmd calls with static values
const winptyGyp = path.join(nodeModules, 'deps', 'winpty', 'src', 'winpty.gyp');
if (fs.existsSync(winptyGyp)) {
  let content = fs.readFileSync(winptyGyp, 'utf8');
  content = content.replace(
    `'WINPTY_COMMIT_HASH%': '<!(cmd /c "cd shared && GetCommitHash.bat")'`,
    `'WINPTY_COMMIT_HASH%': 'none'`
  );
  content = content.replace(
    /'\<!\(cmd \/c "cd shared && UpdateGenVersion\.bat.*?\)'/,
    `'gen'`
  );
  fs.writeFileSync(winptyGyp, content);
  console.log('[patch-node-pty] Patched winpty.gyp (static commit hash)');
}

// 2. Create gen/GenVersion.h
const genDir = path.join(nodeModules, 'deps', 'winpty', 'src', 'gen');
fs.mkdirSync(genDir, { recursive: true });
const versionFile = path.join(nodeModules, 'deps', 'winpty', 'VERSION.txt');
const version = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : '0.4.4-dev';
fs.writeFileSync(
  path.join(genDir, 'GenVersion.h'),
  `// AUTO-GENERATED\nconst char GenVersion_Version[] = "${version}";\nconst char GenVersion_Commit[] = "none";\n`
);
console.log('[patch-node-pty] Created GenVersion.h');

// 3. Remove SpectreMitigation from binding.gyp
const bindingGyp = path.join(nodeModules, 'binding.gyp');
if (fs.existsSync(bindingGyp)) {
  let content = fs.readFileSync(bindingGyp, 'utf8');
  content = content.replace(
    /\s*'msvs_configuration_attributes':\s*\{\s*'SpectreMitigation':\s*'Spectre'\s*\},/g,
    ''
  );
  fs.writeFileSync(bindingGyp, content);
  console.log('[patch-node-pty] Removed SpectreMitigation from binding.gyp');
}

// 4. Remove SpectreMitigation from winpty.gyp
if (fs.existsSync(winptyGyp)) {
  let content = fs.readFileSync(winptyGyp, 'utf8');
  content = content.replace(
    /'SpectreMitigation': 'Spectre'/g,
    ''
  );
  fs.writeFileSync(winptyGyp, content);
  console.log('[patch-node-pty] Removed SpectreMitigation from winpty.gyp');
}

console.log('[patch-node-pty] All patches applied. Run: npx electron-rebuild -m . --only node-pty');
