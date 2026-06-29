/**
 * Filesystem discovery of source files and dotenv files. Uses only Node
 * built-ins (`fs`, `path`) — no glob dependency — and skips the directories
 * that never contain reviewable configuration (`node_modules`, `dist`, `.git`).
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

import type { CodeReference, ParsedEnvFile } from '../types.js';
import { scanSource } from './code-scanner.js';
import { parseDotenv } from '../parse/dotenv.js';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next']);

/** Recursively lists files under `root`, skipping build/vendor directories. */
function walk(root: string, onFile: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(root, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full, onFile);
    } else if (stat.isFile()) {
      onFile(full);
    }
  }
}

/** True for a path that looks like a dotenv file (`.env`, `.env.production`). */
export function isEnvFile(path: string): boolean {
  const name = basename(path);
  return name === '.env' || name.startsWith('.env.');
}

/** Scans every source file under `root` for environment references. */
export function scanProjectCode(root: string): CodeReference[] {
  const refs: CodeReference[] = [];
  walk(root, (path) => {
    if (!SOURCE_EXTS.has(extname(path))) return;
    let src: string;
    try {
      src = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    refs.push(...scanSource(src, path));
  });
  return refs;
}

/** Parses every dotenv file under `root`. */
export function discoverEnvFiles(root: string): ParsedEnvFile[] {
  const files: ParsedEnvFile[] = [];
  walk(root, (path) => {
    if (!isEnvFile(path)) return;
    if (basename(path) === '.env.example') return; // an example, not a source
    let src: string;
    try {
      src = readFileSync(path, 'utf8');
    } catch {
      return;
    }
    files.push(parseDotenv(src, path));
  });
  return files;
}

/** Reads and parses a single dotenv file, or returns `null` if unreadable. */
export function readEnvFile(path: string): ParsedEnvFile | null {
  try {
    return parseDotenv(readFileSync(path, 'utf8'), path);
  } catch {
    return null;
  }
}
