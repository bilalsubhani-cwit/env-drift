/**
 * Parses a Dockerfile for environment-affecting instructions: `ENV` and `ARG`.
 * Handles both `ENV KEY=value [KEY2=value2 …]` and the legacy `ENV KEY value`
 * form, line continuations (`\`), and `#` comments.
 */

import type { AdapterVar } from '../types.js';

const isWs = (ch: string): boolean => ch === ' ' || ch === '\t';
const isKeyStart = (ch: string): boolean =>
  (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
const isKeyPart = (ch: string): boolean => isKeyStart(ch) || (ch >= '0' && ch <= '9');

/** Index of the last non-whitespace character in `line`, or -1. */
function lastNonWs(line: string): number {
  let e = line.length - 1;
  while (e >= 0 && isWs(line[e])) e--;
  return e;
}

/**
 * Joins backslash-continued lines, tracking the starting line number. The
 * continuation check is done with a linear scan rather than a `/\\\s*$/`
 * regex, which can backtrack quadratically (CodeQL js/polynomial-redos).
 */
function logicalLines(src: string): Array<{ text: string; line: number }> {
  const raw = src.replace(/^﻿/, '').split(/\r?\n/);
  const out: Array<{ text: string; line: number }> = [];
  let buffer = '';
  let startLine = 0;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (buffer === '') startLine = i + 1;
    const last = lastNonWs(line);
    if (last >= 0 && line[last] === '\\') {
      // Drop the trailing backslash (and any whitespace after it), join with a space.
      buffer += line.slice(0, last) + ' ';
    } else {
      buffer += line;
      out.push({ text: buffer, line: startLine });
      buffer = '';
    }
  }
  if (buffer !== '') out.push({ text: buffer, line: startLine });
  return out;
}

/**
 * Splits `KEY=val KEY2="a b"` into pairs, respecting quotes. Implemented as a
 * single linear scan (no backtracking regex over the uncontrolled file text).
 */
function parsePairs(s: string): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && isWs(s[i])) i++;
    if (i >= n) break;
    if (!isKeyStart(s[i])) {
      while (i < n && !isWs(s[i])) i++; // skip an unrecognized token
      continue;
    }
    const keyStart = i;
    while (i < n && isKeyPart(s[i])) i++;
    const key = s.slice(keyStart, i);
    if (s[i] !== '=') {
      while (i < n && !isWs(s[i])) i++; // not a KEY=value token; skip it
      continue;
    }
    i++; // consume '='
    let value: string;
    const quote = s[i];
    if (quote === '"' || quote === "'") {
      i++;
      const vs = i;
      while (i < n && s[i] !== quote) i++;
      value = s.slice(vs, i);
      if (i < n) i++; // consume closing quote
    } else {
      const vs = i;
      while (i < n && !isWs(s[i])) i++;
      value = s.slice(vs, i);
    }
    pairs.push({ key, value });
  }
  return pairs;
}

/** Parses a Dockerfile into discovered ENV/ARG variables. */
export function parseDockerfile(content: string, file: string): AdapterVar[] {
  const vars: AdapterVar[] = [];

  for (const { text, line } of logicalLines(content)) {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Split the instruction keyword from its arguments at the first whitespace
    // (linear scan; avoids a `/^(\w+)\s+(.*)$/` regex over uncontrolled input).
    let sp = -1;
    for (let k = 0; k < trimmed.length; k++) {
      if (isWs(trimmed[k])) {
        sp = k;
        break;
      }
    }
    if (sp === -1) continue;
    const keyword = trimmed.slice(0, sp).toUpperCase();
    const args = trimmed.slice(sp + 1).trim();
    const location = { file, line };

    if (keyword === 'ENV') {
      if (args.includes('=')) {
        for (const { key, value } of parsePairs(args)) {
          vars.push({ key, value, location, source: 'Dockerfile ENV', kind: 'env', interpolated: /\$\{?\w/.test(value) });
        }
      } else {
        // Legacy `ENV KEY value` — first token is the key, the rest the value.
        const sp = args.indexOf(' ');
        if (sp !== -1) {
          const key = args.slice(0, sp);
          const value = args.slice(sp + 1).trim();
          vars.push({ key, value, location, source: 'Dockerfile ENV', kind: 'env', interpolated: /\$\{?\w/.test(value) });
        }
      }
    } else if (keyword === 'ARG') {
      const eq = args.indexOf('=');
      if (eq === -1) {
        vars.push({ key: args.trim(), location, source: 'Dockerfile ARG', kind: 'arg' });
      } else {
        const key = args.slice(0, eq).trim();
        const value = args.slice(eq + 1).trim();
        vars.push({ key, value, location, source: 'Dockerfile ARG', kind: 'arg', interpolated: /\$\{?\w/.test(value) });
      }
    }
  }

  return vars;
}
