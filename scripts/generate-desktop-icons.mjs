#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logoPath = path.join(rootDir, 'public', 'highone-logo.svg');
const electronDir = path.join(rootDir, 'electron');
const iconsDir = path.join(electronDir, 'icons');
const iconsetDir = path.join(electronDir, 'icon.icns.iconset');
const winIconsetDir = path.join(electronDir, 'icon.iconset');
const sourceSvgPath = path.join(electronDir, 'icon-source.svg');
const pngPath = path.join(electronDir, 'icon.png');
const png1024Path = path.join(electronDir, 'icon-1024.png');
const icnsPath = path.join(electronDir, 'icon.icns');
const icoPath = path.join(electronDir, 'icon.ico');

const pngSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsEntries = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_64x64.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stripSvgWrapper(svg) {
  return svg
    .replace(/^\s*<\?xml[^>]*>\s*/i, '')
    .replace(/<defs>[\s\S]*?<\/defs>/i, '')
    .replace(/class="cls-1"/g, 'fill="#ffffff"')
    .replace(/<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();
}

function buildSourceSvg() {
  const logoSvg = fs.readFileSync(logoPath, 'utf8');
  const logoInner = stripSvgWrapper(logoSvg);
  const logoWidth = 179.52;
  const logoHeight = 157.43;
  const targetWidth = 700;
  const scale = targetWidth / logoWidth;
  const scaledHeight = logoHeight * scale;
  const translateX = (1024 - targetWidth) / 2;
  const translateY = (1024 - scaledHeight) / 2;
  const iconInset = 64;
  const iconSize = 1024 - iconInset * 2;
  const cornerRadius = 192;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="none"/>
  <rect x="${iconInset}" y="${iconInset}" width="${iconSize}" height="${iconSize}" rx="${cornerRadius}" fill="#000000"/>
  <rect x="${iconInset + 2}" y="${iconInset + 2}" width="${iconSize - 4}" height="${iconSize - 4}" rx="${cornerRadius - 2}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="4"/>
  <g transform="translate(${translateX.toFixed(3)} ${translateY.toFixed(3)}) scale(${scale.toFixed(6)})">
    ${logoInner}
  </g>
</svg>
`;
}

async function renderPng(svg, size, outPath, options = {}) {
  let pipeline = sharp(Buffer.from(svg), { density: 384 }).resize(size, size, { fit: 'contain' });
  if (options.binary) {
    pipeline = pipeline.grayscale().threshold(80);
  }
  await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outPath);
}

function buildIco(entries, outPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directoryEntries = entries.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  fs.writeFileSync(outPath, Buffer.concat([header, ...directoryEntries, ...entries.map((entry) => entry.data)]));
}

async function main() {
  if (!fs.existsSync(logoPath)) {
    throw new Error(`Logo source not found: ${logoPath}`);
  }

  ensureDir(iconsDir);
  ensureDir(iconsetDir);
  ensureDir(winIconsetDir);

  const sourceSvg = buildSourceSvg();
  fs.writeFileSync(sourceSvgPath, sourceSvg, 'utf8');

  for (const size of pngSizes) {
    await renderPng(sourceSvg, size, path.join(iconsDir, `icon-${size}.png`), {
      binary: size <= 32,
    });
  }

  await renderPng(sourceSvg, 1024, pngPath);
  fs.copyFileSync(pngPath, png1024Path);

  for (const [fileName, size] of icnsEntries) {
    await renderPng(sourceSvg, size, path.join(iconsetDir, fileName), {
      binary: size <= 32,
    });
  }

  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
  } else if (!fs.existsSync(icnsPath)) {
    console.warn('Skipping .icns generation because iconutil is only available on macOS.');
  }

  const icoEntries = [];
  for (const size of icoSizes) {
    const outPath = path.join(winIconsetDir, `icon_${size}x${size}.png`);
    await renderPng(sourceSvg, size, outPath, { binary: size <= 32 });
    icoEntries.push({ size, data: fs.readFileSync(outPath) });
  }
  buildIco(icoEntries, icoPath);

  console.log('Desktop icons generated from public/highone-logo.svg');
  console.log(`- ${path.relative(rootDir, sourceSvgPath)}`);
  console.log(`- ${path.relative(rootDir, pngPath)}`);
  console.log(`- ${path.relative(rootDir, icnsPath)}`);
  console.log(`- ${path.relative(rootDir, icoPath)}`);
  console.log(`- ${path.relative(rootDir, iconsDir)}/*.png`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
