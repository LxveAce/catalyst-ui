#!/usr/bin/env node
/**
 * Generates the BMP installer-chrome assets electron-builder's NSIS step
 * references via `nsis.installerHeader` / `nsis.installerSidebar`.
 *
 * Why a script vs committing the BMPs: we want the colors to track the
 * app's accent (`#7c3aed` Purple by default — same as the theme-presets
 * built-in). If we ever change the brand color, this regenerates with one
 * edit. The committed BMPs are checked in so a fresh `npm run dist:win`
 * works without depending on this script running first; the script is
 * idempotent for re-running after a color change.
 *
 * Outputs:
 *   build/installerHeader.bmp  — 150×57, 24-bit BMP (top-right of wizard)
 *   build/installerSidebar.bmp — 164×314, 24-bit BMP (left sidebar)
 *   build/uninstallerSidebar.bmp — copy of installerSidebar
 *
 * The artwork is intentionally simple: a vertical gradient from the
 * accent color (top) to a darker shade (bottom), with the app name in
 * implied negative space. Real designed art can replace these BMPs
 * later — keep the dimensions identical.
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const ACCENT = { r: 0x7c, g: 0x3a, b: 0xed }; // #7c3aed
const ACCENT_DARK = { r: 0x3b, g: 0x18, b: 0x76 }; // ~50% darker

function blend(top, bottom, t) {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(top.r * (1 - k) + bottom.r * k),
    g: Math.round(top.g * (1 - k) + bottom.g * k),
    b: Math.round(top.b * (1 - k) + bottom.b * k),
  };
}

/**
 * Write a 24-bit BMP with a vertical gradient.
 * BMP byte order is BGR (not RGB), bottom-up rows, padded to 4-byte
 * row alignment.
 */
function writeBmpGradient(filePath, width, height, top, bottom) {
  const bytesPerPixel = 3;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const pad = rowSize - width * bytesPerPixel;
  const pixelArraySize = rowSize * height;
  const fileSize = 14 + 40 + pixelArraySize;

  const buf = Buffer.alloc(fileSize);

  // --- BMP File Header (14 bytes) ---
  buf.write('BM', 0); // signature
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt16LE(0, 6); // reserved1
  buf.writeUInt16LE(0, 8); // reserved2
  buf.writeUInt32LE(54, 10); // pixel data offset

  // --- DIB Header (BITMAPINFOHEADER, 40 bytes) ---
  buf.writeUInt32LE(40, 14);             // header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);          // positive = bottom-up
  buf.writeUInt16LE(1, 26);              // color planes
  buf.writeUInt16LE(24, 28);             // bits per pixel
  buf.writeUInt32LE(0, 30);              // compression = BI_RGB
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);            // X pixels per meter (~72 DPI)
  buf.writeInt32LE(2835, 42);            // Y pixels per meter
  buf.writeUInt32LE(0, 46);              // colors in palette
  buf.writeUInt32LE(0, 50);              // important colors

  // --- Pixel data, bottom-up ---
  let offset = 54;
  for (let y = 0; y < height; y++) {
    // Convert to top-down `t` so the gradient appears top→bottom in the
    // rendered image regardless of BMP's bottom-up storage convention.
    const tTopDown = (height - 1 - y) / (height - 1 || 1);
    const c = blend(top, bottom, tTopDown);
    for (let x = 0; x < width; x++) {
      buf[offset++] = c.b;
      buf[offset++] = c.g;
      buf[offset++] = c.r;
    }
    for (let p = 0; p < pad; p++) buf[offset++] = 0;
  }

  writeFileSync(filePath, buf);
}

const header = resolve(HERE, 'installerHeader.bmp');
const sidebar = resolve(HERE, 'installerSidebar.bmp');
const uninstallerSidebar = resolve(HERE, 'uninstallerSidebar.bmp');

writeBmpGradient(header, 150, 57, ACCENT, ACCENT_DARK);
writeBmpGradient(sidebar, 164, 314, ACCENT, ACCENT_DARK);
writeBmpGradient(uninstallerSidebar, 164, 314, ACCENT, ACCENT_DARK);

console.log('[gen-installer-assets] wrote:');
console.log(`  ${header}`);
console.log(`  ${sidebar}`);
console.log(`  ${uninstallerSidebar}`);
