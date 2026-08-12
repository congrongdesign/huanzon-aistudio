#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(rootDir, 'release');

function parseArgs() {
  const args = process.argv.slice(2);
  const platformIndex = args.indexOf('--platform');
  const platform = platformIndex >= 0 ? args[platformIndex + 1] : 'all';
  if (!['all', 'mac', 'win'].includes(platform)) {
    throw new Error(`Invalid --platform value: ${platform}`);
  }
  return { platform, skipArtifacts: args.includes('--skip-artifacts') };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  return fs.readFileSync(path.join(rootDir, file), 'utf8');
}

function listRelease(pattern) {
  if (!fs.existsSync(releaseDir)) return [];
  return fs.readdirSync(releaseDir).filter((name) => pattern.test(name));
}

async function verifyIconPalette(file) {
  const fullPath = path.join(rootDir, file);
  assert(fs.existsSync(fullPath), `Missing icon file: ${file}`);
  const image = sharp(fullPath).ensureAlpha();
  const metadata = await image.metadata();
  assert(metadata.width === metadata.height, `${file} must be square.`);
  const size = metadata.width || 0;
  assert(size >= 16, `${file} size is invalid.`);

  const samples = await image.resize(64, 64).raw().toBuffer();
  let blackPixels = 0;
  let whitePixels = 0;
  let brightNeutralPixels = 0;
  let otherOpaquePixels = 0;
  for (let i = 0; i < samples.length; i += 4) {
    const r = samples[i];
    const g = samples[i + 1];
    const b = samples[i + 2];
    const a = samples[i + 3];
    if (a < 220) continue;
    if (r < 8 && g < 8 && b < 8) blackPixels += 1;
    else if (r > 230 && g > 230 && b > 230) whitePixels += 1;
    else if (r > 150 && g > 150 && b > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 10) {
      brightNeutralPixels += 1;
    }
    else otherOpaquePixels += 1;
  }

  const opaque = blackPixels + whitePixels + brightNeutralPixels + otherOpaquePixels;
  assert(opaque > 0, `${file} has no opaque pixels.`);
  assert(blackPixels / opaque > 0.55, `${file} must use a dominant pure black background.`);
  assert((whitePixels + brightNeutralPixels) / opaque > 0.05, `${file} must contain a visible white logo.`);
  assert(otherOpaquePixels / opaque < 0.18, `${file} contains too many non black/white pixels.`);
}

function verifyBuilderConfig() {
  const yml = read('electron-builder.yml');
  assert(/appId:\s*com\.huanzon\.aistudio/.test(yml), 'appId must remain fixed.');
  assert(/guid:\s*7f9f4b4f-5d1f-4c7e-9ef0-9c28437b6d36/.test(yml), 'nsis.guid must remain fixed.');
  assert(/deleteAppDataOnUninstall:\s*false/.test(yml), 'deleteAppDataOnUninstall must be false.');
  assert(/provider:\s*generic/.test(yml), 'publish provider must be generic.');
  assert(/target:\s*zip/.test(yml), 'mac zip target is required for latest-mac.yml auto update metadata.');
  assert(/target:\s*nsis/.test(yml), 'Windows target must be NSIS for electron-updater.');
}

function verifyUpdaterRuntime() {
  const runtimePackage = path.join(rootDir, '.desktop-runtime', 'updater', 'node_modules', 'electron-updater', 'package.json');
  assert(fs.existsSync(runtimePackage), 'Prepared electron-updater runtime is missing. Run desktop:prepare-updater.');
}

function verifyMacArtifacts() {
  const dmgs = listRelease(/^环中AIStudio-\d+\.\d+\.\d+-arm64\.dmg$/);
  const zips = listRelease(/^环中AIStudio-\d+\.\d+\.\d+-arm64\.zip$/);
  assert(dmgs.length === 1, `Expected exactly one public macOS DMG, found ${dmgs.length}: ${dmgs.join(', ')}`);
  assert(zips.length === 1, `Expected exactly one hidden macOS ZIP update artifact, found ${zips.length}: ${zips.join(', ')}`);
  assert(fs.existsSync(path.join(releaseDir, 'latest-mac.yml')), 'Missing latest-mac.yml for macOS auto update.');

  const appDir = path.join(releaseDir, 'mac-arm64', '环中AIStudio.app');
  if (fs.existsSync(appDir)) {
    assert(fs.existsSync(path.join(appDir, 'Contents', 'Resources', 'icon.icns')), 'mac app icon.icns is missing.');
    assert(fs.existsSync(path.join(appDir, 'Contents', 'Resources', 'icon.png')), 'mac resources icon.png is missing.');
    assert(fs.existsSync(path.join(appDir, 'Contents', 'Resources', 'updater', 'node_modules', 'electron-updater', 'package.json')), 'mac updater runtime is missing.');
    assert(fs.existsSync(path.join(appDir, 'Contents', 'Resources', 'standalone', 'server.js')), 'mac standalone server is missing.');
  }
}

function verifyWinArtifacts() {
  const exes = listRelease(/^环中AIStudio-Setup-\d+\.\d+\.\d+\.exe$/);
  assert(exes.length === 1, `Expected exactly one public Windows installer, found ${exes.length}: ${exes.join(', ')}`);
  assert(fs.existsSync(path.join(releaseDir, `${exes[0]}.blockmap`)), 'Missing Windows installer blockmap.');
  assert(fs.existsSync(path.join(releaseDir, 'latest.yml')), 'Missing latest.yml for Windows auto update.');

  const unpacked = path.join(releaseDir, 'win-unpacked');
  if (fs.existsSync(unpacked)) {
    assert(fs.existsSync(path.join(unpacked, 'resources', 'icon.png')), 'win resources icon.png is missing.');
    assert(fs.existsSync(path.join(unpacked, 'resources', 'updater', 'node_modules', 'electron-updater', 'package.json')), 'win updater runtime is missing.');
    assert(fs.existsSync(path.join(unpacked, 'resources', 'standalone', 'server.js')), 'win standalone server is missing.');
  }
}

async function main() {
  const { platform, skipArtifacts } = parseArgs();
  verifyBuilderConfig();
  verifyUpdaterRuntime();
  await verifyIconPalette('electron/icon.png');
  await verifyIconPalette('electron/icons/icon-16.png');
  await verifyIconPalette('electron/icons/icon-1024.png');
  assert(fs.existsSync(path.join(rootDir, 'electron', 'icon.icns')), 'Missing electron/icon.icns.');
  assert(fs.existsSync(path.join(rootDir, 'electron', 'icon.ico')), 'Missing electron/icon.ico.');

  if (!skipArtifacts) {
    if (platform === 'mac' || platform === 'all') verifyMacArtifacts();
    if (platform === 'win' || platform === 'all') verifyWinArtifacts();
  }

  console.log(`Desktop release verification passed for platform=${platform}${skipArtifacts ? ' (artifacts skipped)' : ''}.`);
}

main().catch((error) => {
  console.error(`Desktop release verification failed: ${error.message}`);
  process.exit(1);
});
