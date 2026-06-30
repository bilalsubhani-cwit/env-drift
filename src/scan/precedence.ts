/**
 * Resolves which `.env` file actually wins for each key, so envcanary can show
 * provenance and detect shadowing (`ENV006`).
 *
 * The precedence order follows the widely-used dotenv/Next.js layering, where a
 * developer's local override file outranks the committed, reviewed files:
 *
 *   .env.{environment}.local   (5, local override — usually gitignored)
 *   .env.local                 (4, local override — usually gitignored)
 *   .env.{environment}         (3, committed, environment-specific)
 *   .env                       (2, committed, base)
 *   .env.{other}               (1, a different environment's file)
 *
 * Layering a committed environment file over the committed base is intentional
 * and is **not** flagged. Shadowing a *committed* value with a different value
 * from an *unreviewed* `.local` file is what `ENV006` reports.
 */

import { basename } from 'node:path';
import type { ParsedEnvFile, SourceLocation } from '../types.js';

/** One definition of a key, with the file that provided it. */
export interface KeyDefinition {
  file: string;
  value: string;
  rank: number;
  isLocal: boolean;
  location: SourceLocation;
}

/** The provenance of a single key: the winner plus every shadowed definition. */
export interface KeyProvenance {
  key: string;
  winner: KeyDefinition;
  shadowed: KeyDefinition[];
}

/** The result of resolving precedence across a set of `.env` files. */
export interface PrecedenceResult {
  /** Effective key→value map (winner per key). */
  values: Record<string, string>;
  /** Per-key provenance, only for keys defined in more than one file. */
  provenance: KeyProvenance[];
}

/** Precedence rank for a file in the context of `environment` (higher wins). */
export function precedenceRank(file: string, environment: string): number {
  const base = basename(file);
  if (base === `.env.${environment}.local`) return 5;
  if (base === '.env.local') return 4;
  if (base === `.env.${environment}`) return 3;
  if (base === '.env') return 2;
  return 1; // a different environment's file (e.g. .env.development under prod)
}

/** True for an unreviewed local-override file (`.env.local`, `.env.*.local`). */
export function isLocalSource(file: string): boolean {
  return basename(file).endsWith('.local');
}

/**
 * Resolves the effective value and provenance for every key across the given
 * files, for a target environment.
 */
export function resolvePrecedence(
  files: ParsedEnvFile[],
  environment: string,
): PrecedenceResult {
  const defs = new Map<string, KeyDefinition[]>();

  for (const f of files) {
    const rank = precedenceRank(f.file, environment);
    const isLocal = isLocalSource(f.file);
    // Within a single file, the last definition wins (dotenv semantics), so we
    // keep only the final entry per key from that file.
    const lastPerKey = new Map<string, KeyDefinition>();
    for (const e of f.entries) {
      lastPerKey.set(e.key, { file: f.file, value: e.value, rank, isLocal, location: e.location });
    }
    for (const [key, def] of lastPerKey) {
      const list = defs.get(key);
      if (list) list.push(def);
      else defs.set(key, [def]);
    }
  }

  const values: Record<string, string> = {};
  const provenance: KeyProvenance[] = [];

  for (const [key, list] of defs) {
    // Highest rank wins; on a tie, the later-discovered file wins.
    let winner = list[0];
    for (const d of list) {
      if (d.rank >= winner.rank) winner = d;
    }
    values[key] = winner.value;

    if (list.length > 1) {
      provenance.push({
        key,
        winner,
        shadowed: list.filter((d) => d !== winner),
      });
    }
  }

  return { values, provenance };
}
