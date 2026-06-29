/**
 * Filesystem discovery of source files and dotenv files. Uses only Node
 * built-ins (`fs`, `path`) — no glob dependency — and skips the directories
 * that never contain reviewable configuration (`node_modules`, `dist`, `.git`).
 */

import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

import type { CodeReference, ParsedEnvFile } from '../types.js';
import { scanSource } from './code-scanner.js';
import { parseDotenv } from '../parse/dotenv.js';

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.next']);

// Resource-exhaustion guards (DoS defence). A repository scan is bounded in
// depth, file count, and per-file size, and never follows symlinks — so a
// crafted symlink loop, a pathologically deep tree, or a giant file cannot hang
// the process or exhaust memory.
const MAX_DEPTH = 40;
const MAX_FILES = 50_000;
/** Files larger than this are skipped during scanning (5 MB). */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Recursively lists files under `root`, skipping build/vendor directories.
 * Symbolic links are never traversed (loop / traversal defence), and the walk
 * is bounded by {@link MAX_DEPTH} and {@link MAX_FILES}. `onFile` receives the
 * path and the file's size in bytes.
 */
function walk(root: string, onFile: (path: string, size: number) => void): void {
  let count = 0;

  const recurse = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || count >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (count >= MAX_FILES) return;
      const full = join(dir, name);
      let stat;
      try {
        // lstat (not stat) so symlinks are detected and never followed.
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        recurse(full, depth + 1);
      } else if (stat.isFile()) {
        count++;
        onFile(full, stat.size);
      }
    }
  };

  recurse(root, 0);
}

/** True for a path that looks like a dotenv file (`.env`, `.env.production`). */
export function isEnvFile(path: string): boolean {
  const name = basename(path);
  return name === '.env' || name.startsWith('.env.');
}

/** Lists files under `root` whose path satisfies `match` (skips vendor dirs). */
export function findFiles(root: string, match: (path: string) => boolean): string[] {
  const out: string[] = [];
  walk(root, (path, size) => {
    if (size <= MAX_FILE_BYTES && match(path)) out.push(path);
  });
  return out;
}

/** Scans every source file under `root` for environment references. */
export function scanProjectCode(root: string): CodeReference[] {
  const refs: CodeReference[] = [];
  walk(root, (path, size) => {
    if (size > MAX_FILE_BYTES || !SOURCE_EXTS.has(extname(path))) return;
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
  walk(root, (path, size) => {
    if (size > MAX_FILE_BYTES || !isEnvFile(path)) return;
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
