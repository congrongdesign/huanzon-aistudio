#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(rootDir, '.desktop-runtime', 'updater');
const outputNodeModules = path.join(outputRoot, 'node_modules');
const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
const copied = new Set();

function packageNameFromRequest(request) {
  if (request.startsWith('@')) {
    const [scope, name] = request.split('/');
    return `${scope}/${name}`;
  }
  return request.split('/')[0];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function destinationForPackage(packageName) {
  return path.join(outputNodeModules, ...packageName.split('/'));
}

function copyPackage(packageName, resolveFrom) {
  if (copied.has(packageName)) return;

  const packageJsonPath = requireFromRoot.resolve(`${packageName}/package.json`, {
    paths: resolveFrom,
  });
  const sourceDir = path.dirname(packageJsonPath);
  const packageJson = readJson(packageJsonPath);
  const destinationDir = destinationForPackage(packageName);

  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
  fs.cpSync(sourceDir, destinationDir, {
    recursive: true,
    dereference: true,
    filter: (source) => path.basename(source) !== 'node_modules',
  });
  copied.add(packageName);

  const dependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.optionalDependencies || {}),
  };

  for (const dependencyName of Object.keys(dependencies)) {
    copyPackage(packageNameFromRequest(dependencyName), [sourceDir, rootDir]);
  }
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputNodeModules, { recursive: true });
copyPackage('electron-updater', [rootDir]);

const remainingLinks = [];
function collectSymlinks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      remainingLinks.push(fullPath);
    } else if (entry.isDirectory()) {
      collectSymlinks(fullPath);
    }
  }
}
collectSymlinks(outputRoot);
if (remainingLinks.length > 0) {
  console.error(`Updater runtime still contains ${remainingLinks.length} symlink(s):`);
  for (const link of remainingLinks.slice(0, 20)) console.error(`- ${path.relative(rootDir, link)}`);
  process.exit(1);
}

console.log(`Prepared electron-updater runtime: ${path.relative(rootDir, outputRoot)}`);
console.log(`Packages: ${Array.from(copied).sort().join(', ')}`);
