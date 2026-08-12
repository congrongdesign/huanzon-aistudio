#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    mode: '',
    set: '',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--mode') {
      args.mode = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--set') {
      args.set = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    throw new Error(`Unknown arg: ${token}`);
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function bump(version, mode) {
  const parsed = parseSemver(version);
  if (!parsed) throw new Error(`Invalid semver version: ${version}`);
  if (mode === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (mode === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (mode === 'major') return `${parsed.major + 1}.0.0`;
  throw new Error(`Invalid mode: ${mode}. Expected patch/minor/major.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode && !args.set) {
    throw new Error('Provide either --mode patch|minor|major or --set X.Y.Z');
  }
  if (args.mode && args.set) {
    throw new Error('Use only one of --mode or --set');
  }

  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found: ${packageJsonPath}`);
  }
  const packageJson = readJson(packageJsonPath);
  const current = String(packageJson.version || '');
  if (!parseSemver(current)) {
    throw new Error(`Current package.json version is invalid: ${current}`);
  }

  let next = '';
  if (args.set) {
    if (!parseSemver(args.set)) throw new Error(`Invalid --set version: ${args.set}`);
    next = args.set;
  } else {
    next = bump(current, args.mode);
  }

  if (next === current) throw new Error(`Next version equals current version: ${current}`);

  if (args.dryRun) {
    console.log(`desktop-version-bump dry-run: ${current} -> ${next}`);
    return;
  }

  packageJson.version = next;
  writeJson(packageJsonPath, packageJson);
  console.log(`desktop-version-bump: ${current} -> ${next}`);
}

try {
  main();
} catch (error) {
  console.error(`desktop-version-bump failed: ${error.message}`);
  process.exit(1);
}

