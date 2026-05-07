import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standaloneDir = path.join(root, '.next', 'standalone');
const nextStaticDir = path.join(root, '.next', 'static');
const publicDir = path.join(root, 'public');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyDir(src, dst) {
  ensureDir(dst);
  fs.cpSync(src, dst, { recursive: true, force: true });
}

if (!exists(standaloneDir)) {
  console.log('[standalone:prepare] .next/standalone not found, skipping');
  process.exit(0);
}

const standaloneNextDir = path.join(standaloneDir, '.next');
ensureDir(standaloneNextDir);

if (exists(nextStaticDir)) {
  copyDir(nextStaticDir, path.join(standaloneNextDir, 'static'));
  console.log('[standalone:prepare] copied .next/static -> .next/standalone/.next/static');
}

if (exists(publicDir)) {
  copyDir(publicDir, path.join(standaloneDir, 'public'));
  console.log('[standalone:prepare] copied public -> .next/standalone/public');
}

