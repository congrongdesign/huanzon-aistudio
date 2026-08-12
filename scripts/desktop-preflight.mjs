#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    rollback: '',
    ring: '',
    strict: false,
    requireVersionBump: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      continue;
    }
    if (token === '--rollback') {
      args.rollback = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--ring') {
      args.ring = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--strict') {
      args.strict = true;
      continue;
    }
    if (token === '--require-version-bump') {
      args.requireVersionBump = true;
      continue;
    }
    throw new Error(`Unknown arg: ${token}`);
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isSemverLike(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
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

function fileExists(relPath) {
  return fs.existsSync(path.join(rootDir, relPath));
}

function listReleaseFiles() {
  const releaseDir = path.join(rootDir, 'release');
  if (!fs.existsSync(releaseDir)) return [];
  return fs.readdirSync(releaseDir).filter((name) => fs.statSync(path.join(releaseDir, name)).isFile());
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const errors = [];
  const warnings = [];

  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in ${rootDir}`);
  }
  const packageJson = readJson(packageJsonPath);
  const version = packageJson.version || '';

  if (!isSemverLike(version)) {
    errors.push(`package.json version is invalid: ${version}`);
  }

  const packageManager = String(packageJson.packageManager || '');
  if (!packageManager.startsWith('pnpm@')) {
    errors.push(`packageManager must be pnpm, got: ${packageManager || '(empty)'}`);
  }

  if (args.requireVersionBump) {
    const releaseFiles = listReleaseFiles();
    const matched = releaseFiles.filter((name) => {
      const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`-${escapedVersion}(?:-|\\.)`);
      return regex.test(name);
    });
    if (matched.length > 0) {
      errors.push(
        `release artifacts already exist for version ${version}. Bump version before packaging. Matched: ${matched.join(', ')}`
      );
    }
  }

  const requiredFiles = [
    'pnpm-lock.yaml',
    'electron-builder.yml',
    'electron/icon.png',
    'electron/icon.icns',
    'electron/icon.ico',
    'scripts/electron-release.sh',
    'scripts/electron-release-mac.sh',
    'scripts/electron-release-win.sh',
    'scripts/verify-desktop-release.mjs',
  ];
  for (const relPath of requiredFiles) {
    if (!fileExists(relPath)) {
      errors.push(`missing file: ${relPath}`);
    }
  }

  const builderPath = path.join(rootDir, 'electron-builder.yml');
  const builderYml = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf8') : '';
  if (!/appId:\s*com\.huanzon\.aistudio/.test(builderYml)) {
    errors.push('electron-builder.yml appId is missing or changed from com.huanzon.aistudio');
  }
  if (!/guid:\s*7f9f4b4f-5d1f-4c7e-9ef0-9c28437b6d36/.test(builderYml)) {
    errors.push('electron-builder.yml nsis guid is missing or changed');
  }
  if (/updates\.example\.com/.test(builderYml)) {
    warnings.push('publish url still points to updates.example.com placeholder');
  }

  if (!args.rollback) {
    warnings.push('rollback version not provided (pass --rollback <version>)');
  } else if (args.rollback === 'auto') {
    const derived = autoRollbackVersion(version);
    if (!derived) {
      warnings.push('rollback auto derive failed; pass --rollback <version>');
    } else {
      args.rollback = derived;
      console.log(`Derived rollback version from current version: ${args.rollback}`);
    }
  } else if (!isSemverLike(args.rollback)) {
    errors.push(`rollback version is invalid: ${args.rollback}`);
  } else if (args.rollback === version) {
    errors.push(`rollback version cannot equal current version: ${version}`);
  }

  if (!args.ring) {
    warnings.push('release ring not provided (pass --ring ring0|ring1|ring2)');
  } else if (!['ring0', 'ring1', 'ring2'].includes(args.ring)) {
    errors.push(`ring must be ring0/ring1/ring2, got: ${args.ring}`);
  }

  const occupiedPorts = [];
  for (let port = 5000; port <= 5009; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    const available = await checkPortAvailable(port);
    if (!available) occupiedPorts.push(port);
  }
  if (occupiedPorts.length > 0) {
    warnings.push(`ports in use: ${occupiedPorts.join(', ')}`);
  }

  console.log(`Desktop preflight for v${version}`);
  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  if (errors.length > 0 || (args.strict && warnings.length > 0)) {
    const strictErrors = args.strict && warnings.length > 0 ? warnings.map((w) => `[strict] ${w}`) : [];
    const allErrors = [...errors, ...strictErrors];
    console.error(`Preflight failed (${allErrors.length}):`);
    for (const error of allErrors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('Preflight passed.');
}

main().catch((error) => {
  console.error(`Preflight crashed: ${error.message}`);
  process.exit(1);
});
