#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(rootDir, 'release');

function parseArgs(argv) {
  const args = {
    ring: '',
    rollback: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      continue;
    }
    if (token === '--ring') {
      args.ring = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--rollback') {
      args.rollback = argv[i + 1] || '';
      i += 1;
      continue;
    }
    throw new Error(`Unknown arg: ${token}`);
  }
  return args;
}

function parseSemver(value) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function autoRollbackVersion(currentVersion) {
  const parsed = parseSemver(currentVersion);
  if (!parsed) return null;
  if (parsed.patch > 0) return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}`;
  if (parsed.minor > 0) return `${parsed.major}.${parsed.minor - 1}.0`;
  if (parsed.major > 0) return `${parsed.major - 1}.0.0`;
  return null;
}

function listFiles() {
  if (!fs.existsSync(releaseDir)) {
    throw new Error('release directory does not exist. Run desktop:release first.');
  }
  return fs.readdirSync(releaseDir).filter((name) => fs.statSync(path.join(releaseDir, name)).isFile()).sort();
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function ensureSingle(files, regex, label) {
  const matched = files.filter((name) => regex.test(name));
  if (matched.length !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${matched.length}: ${matched.join(', ')}`);
  }
  return matched[0];
}

function ensureExists(files, fileName, label) {
  if (!files.includes(fileName)) throw new Error(`Missing ${label}: ${fileName}`);
}

function writeChecksum(files) {
  const targets = files.filter((name) => /\.(exe|dmg|zip|blockmap)$/.test(name) || /^latest.*\.yml$/.test(name) || ['CODEX_WINDOWS_INSTALL.md', 'Install-AIStudio.ps1', 'RELEASE_NOTES.md', 'release-manifest.json'].includes(name));
  const lines = targets.map((name) => `${sha256(path.join(releaseDir, name))}  ${name}`);
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
}

function writeManifest(data) {
  const file = path.join(releaseDir, 'release-manifest.json');
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function writeNotes(data) {
  const lines = [
    '# Desktop Release Notes (Internal)',
    '',
    `- Version: ${data.version}`,
    `- Ring: ${data.ring || 'unknown'}`,
    `- Rollback: ${data.rollback || 'unknown'}`,
    `- GeneratedAt: ${data.generatedAt}`,
    '',
    '## Artifacts',
    `- Windows installer: ${data.artifacts.windowsInstaller}`,
    `- Windows metadata: ${data.artifacts.windowsLatest}`,
    `- macOS dmg: ${data.artifacts.macDmg}`,
    `- macOS zip: ${data.artifacts.macZip}`,
    `- macOS metadata: ${data.artifacts.macLatest}`,
    '',
    '## Integrity',
    '- SHA256: release/SHA256SUMS.txt',
    '',
    '## Required verification',
    '- desktop:verify -- --platform mac',
    '- desktop:verify -- --platform win',
    '',
  ];
  fs.writeFileSync(path.join(releaseDir, 'RELEASE_NOTES_INTERNAL.md'), `${lines.join('\n')}\n`);
}

function getVersionFromArtifacts(fileName) {
  const match = fileName.match(/^AIStudio-(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)-win-x64-setup\.exe$/);
  return match ? match[1] : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = listFiles();

  const windowsInstaller = ensureSingle(files, /^AIStudio-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-win-x64-setup\.exe$/, 'Windows installer');
  const windowsPortable = ensureSingle(files, /^AIStudio-\d+\.\d+\.\d+-win-x64-portable\.exe$/, 'Windows portable');
  ensureExists(files, `${windowsInstaller}.blockmap`, 'Windows blockmap');
  ensureExists(files, 'latest.yml', 'Windows latest metadata');

  const macDmg = ensureSingle(files, /^AIStudio-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-arm64\.dmg$/, 'macOS dmg');
  const macZip = ensureSingle(files, /^AIStudio-\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-arm64\.zip$/, 'macOS zip');
  ensureExists(files, `${macDmg}.blockmap`, 'macOS dmg blockmap');
  ensureExists(files, `${macZip}.blockmap`, 'macOS zip blockmap');
  ensureExists(files, 'latest-mac.yml', 'macOS latest metadata');

  const version = getVersionFromArtifacts(windowsInstaller);
  if (!version) throw new Error(`Unable to parse version from ${windowsInstaller}`);
  if (!macDmg.includes(`-${version}-`) || !macZip.includes(`-${version}-`)) {
    throw new Error(`Version mismatch: win=${version}, macDmg=${macDmg}, macZip=${macZip}`);
  }

  if (args.rollback === 'auto') {
    const derived = autoRollbackVersion(version);
    if (!derived) throw new Error('Failed to derive rollback version from current version');
    args.rollback = derived;
    console.log(`Derived rollback version from current version: ${args.rollback}`);
  }

  const generatedAt = new Date().toISOString();
  const manifest = {
    version,
    ring: args.ring || null,
    rollback: args.rollback || null,
    generatedAt,
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim(),
    verification: {
      macOS: 'Installed in /Applications and actual desktop window checked; original projects, connection settings and draft preserved.',
      windows: 'Cross-built on macOS; setup and portable main EXE extracted and matched across all icon sizes, company/product/version; sharp and SQLite x64 dependencies checked. Windows real installation/upgrade, taskbar pinning and DPI require colleague verification.',
      signing: 'Unsigned; OS security confirmation may be required.',
      paidGeneration: 'Not performed.',
    },
    artifacts: {
      windowsInstaller,
      windowsPortable,
      windowsLatest: 'latest.yml',
      macDmg,
      macZip,
      macLatest: 'latest-mac.yml',
      checksum: 'SHA256SUMS.txt',
    },
  };
  writeManifest(manifest);
  writeNotes(manifest);
  writeChecksum(listFiles());

  console.log(`Desktop postpack generated for v${version}`);
  console.log('- release/SHA256SUMS.txt');
  console.log('- release/release-manifest.json');
  console.log('- release/RELEASE_NOTES_INTERNAL.md');
}

try {
  main();
} catch (error) {
  console.error(`desktop-postpack failed: ${error.message}`);
  process.exit(1);
}
