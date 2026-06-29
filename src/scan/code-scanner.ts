/**
 * Discovers environment-variable references in JS/TS source by matching
 * patterns over the token stream from `tokenize.ts`. Detects:
 *
 * ```ts
 * process.env.DATABASE_URL
 * process.env["DATABASE_URL"]
 * import.meta.env.VITE_API_URL
 * Bun.env.PORT
 * Deno.env.get("DATABASE_URL")
 * const { DATABASE_URL } = process.env   // destructuring
 * ```
 *
 * Computed access (`process.env[prefix + key]`, a template-literal key, or a
 * non-string `Deno.env.get(...)` argument) is reported with `dynamic: true`
 * and `key: null` — the scanner never guesses the resulting name.
 */

import type { CodeReference } from '../types.js';
import { tokenize, type Token } from './tokenize.js';

/** Identifier sequences that resolve to an environment object. */
const ENV_OBJECTS: ReadonlyArray<{ idents: string[]; accessor: string }> = [
  { idents: ['process', 'env'], accessor: 'process.env' },
  { idents: ['import', 'meta', 'env'], accessor: 'import.meta.env' },
  { idents: ['Bun', 'env'], accessor: 'Bun.env' },
];

function isPunct(tok: Token | undefined, value: string): boolean {
  return !!tok && tok.type === 'punct' && tok.value === value;
}

function isIdent(tok: Token | undefined): boolean {
  return !!tok && tok.type === 'ident';
}

/**
 * Tries to match an env object (`process.env`, `import.meta.env`, `Bun.env`)
 * starting at token index `t`. Returns the accessor label and the number of
 * tokens consumed, or `null`.
 */
function matchEnvObject(
  tokens: Token[],
  t: number,
): { accessor: string; len: number } | null {
  for (const obj of ENV_OBJECTS) {
    let ok = true;
    let idx = t;
    for (let k = 0; k < obj.idents.length; k++) {
      if (k > 0) {
        if (!isPunct(tokens[idx], '.')) {
          ok = false;
          break;
        }
        idx++;
      }
      if (!isIdent(tokens[idx]) || tokens[idx].value !== obj.idents[k]) {
        ok = false;
        break;
      }
      idx++;
    }
    if (ok) return { accessor: obj.accessor, len: idx - t };
  }
  return null;
}

/**
 * Handles `const { A, B } = process.env` by scanning backwards from an env
 * object that is used as a bare value. Returns the destructured key names with
 * the brace's location, or `null` if this is not a destructuring assignment.
 */
function matchDestructure(
  tokens: Token[],
  envStart: number,
): CodeReference[] | null {
  // Expect `... } = <envObject>`: token before envStart is `=`, before that `}`.
  if (!isPunct(tokens[envStart - 1], '=')) return null;
  if (!isPunct(tokens[envStart - 2], '}')) return null;

  // Walk back to the matching `{`.
  let depth = 0;
  let open = -1;
  for (let k = envStart - 2; k >= 0; k--) {
    if (isPunct(tokens[k], '}')) depth++;
    else if (isPunct(tokens[k], '{')) {
      depth--;
      if (depth === 0) {
        open = k;
        break;
      }
    }
  }
  if (open === -1) return null;

  const refs: CodeReference[] = [];
  // Collect the first identifier of each comma-separated binding. Renames like
  // `{ DATABASE_URL: db }` still key on the source name (the first ident).
  let expectKey = true;
  for (let k = open + 1; k < envStart - 2; k++) {
    const tok = tokens[k];
    if (isPunct(tok, ',')) {
      expectKey = true;
      continue;
    }
    if (expectKey && tok.type === 'ident') {
      refs.push({
        key: tok.value,
        location: { file: '', line: tok.line, column: tok.col },
        accessor: 'destructure process.env',
        dynamic: false,
      });
      expectKey = false;
    }
  }
  return refs.length ? refs : null;
}

/** Scans an already-tokenized source. `file` labels the locations. */
function scanTokens(tokens: Token[], file: string): CodeReference[] {
  const refs: CodeReference[] = [];
  const push = (r: CodeReference): void => {
    r.location.file = file;
    refs.push(r);
  };

  for (let t = 0; t < tokens.length; t++) {
    // ---- Deno.env.get("KEY") / Deno.env.has("KEY") -----------------------
    if (
      isIdent(tokens[t]) &&
      tokens[t].value === 'Deno' &&
      isPunct(tokens[t + 1], '.') &&
      isIdent(tokens[t + 2]) &&
      tokens[t + 2].value === 'env' &&
      isPunct(tokens[t + 3], '.') &&
      isIdent(tokens[t + 4]) &&
      (tokens[t + 4].value === 'get' || tokens[t + 4].value === 'has') &&
      isPunct(tokens[t + 5], '(')
    ) {
      const arg = tokens[t + 6];
      const loc = { file, line: tokens[t].line, column: tokens[t].col };
      if (arg && arg.type === 'string') {
        push({ key: arg.value, location: loc, accessor: `Deno.env.${tokens[t + 4].value}`, dynamic: false });
      } else {
        push({ key: null, location: loc, accessor: `Deno.env.${tokens[t + 4].value}`, dynamic: true });
      }
      t += 5;
      continue;
    }

    const env = matchEnvObject(tokens, t);
    if (!env) continue;

    const after = t + env.len;
    const loc = { file, line: tokens[t].line, column: tokens[t].col };

    // ---- process.env.KEY -------------------------------------------------
    if (isPunct(tokens[after], '.') && isIdent(tokens[after + 1])) {
      push({ key: tokens[after + 1].value, location: loc, accessor: env.accessor, dynamic: false });
      t = after + 1;
      continue;
    }

    // ---- process.env["KEY"] or computed ----------------------------------
    if (isPunct(tokens[after], '[')) {
      const inner = tokens[after + 1];
      if (inner && inner.type === 'string' && isPunct(tokens[after + 2], ']')) {
        push({ key: inner.value, location: loc, accessor: `${env.accessor}[...]`, dynamic: false });
        t = after + 2;
      } else {
        push({ key: null, location: loc, accessor: `${env.accessor}[...]`, dynamic: true });
        t = after;
      }
      continue;
    }

    // ---- const { A, B } = process.env ------------------------------------
    const destructured = matchDestructure(tokens, t);
    if (destructured) {
      for (const r of destructured) push(r);
      t = after - 1;
      continue;
    }
  }

  return refs;
}

/** Scans a single source string for environment-variable references. */
export function scanSource(src: string, file: string): CodeReference[] {
  return scanTokens(tokenize(src), file);
}
