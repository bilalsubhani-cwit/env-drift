/**
 * Locates and loads the environment contract from disk.
 *
 * Supported forms (first match wins):
 *   env-drift.config.js / .cjs / .mjs   — a module whose default (or
 *                                         module.exports) export is the contract
 *   env-drift.config.json               — the raw contract shape as JSON
 *
 * TypeScript configs (`.ts`) are intentionally not loaded directly: env-drift
 * ships zero runtime dependencies and will not pull in a TS loader. Compile the
 * config, or author it in JS/JSON. The CLI reports this as a clear error.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Contract } from '../types.js';

/**
 * A real dynamic `import()`, hidden behind `Function` so the CommonJS build
 * does not transpile it into `require()` (which cannot load ESM or file URLs).
 * Native `import()` loads `.mjs`, `.js`, and `.cjs` (CommonJS default export).
 */
const dynamicImport = new Function('url', 'return import(url)') as (
  url: string,
) => Promise<{ default?: Contract } & Record<string, unknown>>;

const CANDIDATES = [
  'env-drift.config.js',
  'env-drift.config.cjs',
  'env-drift.config.mjs',
  'env-drift.config.json',
];

/** An error loading or resolving the contract (CLI exit code 2). */
export class ContractLoadError extends Error {}

/** Finds a contract file in `dir`, or returns `null`. */
export function findContract(dir: string): string | null {
  for (const name of CANDIDATES) {
    const full = join(dir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/** Loads a contract from an explicit path or by searching `cwd`. */
export async function loadContract(pathOrDir: string): Promise<{ contract: Contract; file: string }> {
  const target = isAbsolute(pathOrDir) ? pathOrDir : resolve(pathOrDir);

  // Resolve to a concrete file: an existing file is used as-is; an existing
  // directory is searched; otherwise fall back to searching the cwd.
  let resolved: string | null = null;
  if (existsSync(target)) {
    resolved = statSync(target).isDirectory() ? findContract(target) : target;
  } else {
    resolved = findContract(process.cwd());
  }

  if (!resolved) {
    throw new ContractLoadError(
      `no contract found. Create one of: ${CANDIDATES.join(', ')} (see \`env-drift init\`).`,
    );
  }

  if (resolved.endsWith('.ts')) {
    throw new ContractLoadError(
      `TypeScript configs are not loaded directly (zero-dependency policy). ` +
        `Compile "${resolved}" to JS, or author an env-drift.config.js / .json contract.`,
    );
  }

  if (resolved.endsWith('.json')) {
    const contract = JSON.parse(readFileSync(resolved, 'utf8')) as Contract;
    return { contract, file: resolved };
  }

  // JS / MJS / CJS — import dynamically so both module systems work.
  const mod = await dynamicImport(pathToFileURL(resolved).href);
  const contract = (mod.default ?? (mod as unknown as Contract));
  return { contract, file: resolved };
}
