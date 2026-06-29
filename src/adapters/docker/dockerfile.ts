/**
 * Parses a Dockerfile for environment-affecting instructions: `ENV` and `ARG`.
 * Handles both `ENV KEY=value [KEY2=value2 …]` and the legacy `ENV KEY value`
 * form, line continuations (`\`), and `#` comments.
 */

import type { AdapterVar } from '../types.js';

const CONT = /\\\s*$/;

/** Joins backslash-continued lines, tracking the starting line number. */
function logicalLines(src: string): Array<{ text: string; line: number }> {
  const raw = src.replace(/^﻿/, '').split(/\r?\n/);
  const out: Array<{ text: string; line: number }> = [];
  let buffer = '';
  let startLine = 0;
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (buffer === '') startLine = i + 1;
    if (CONT.test(line)) {
      buffer += line.replace(CONT, ' ');
    } else {
      buffer += line;
      out.push({ text: buffer, line: startLine });
      buffer = '';
    }
  }
  if (buffer !== '') out.push({ text: buffer, line: startLine });
  return out;
}

/** Splits `KEY=val KEY2="a b"` into pairs, respecting quotes. */
function parsePairs(s: string): Array<{ key: string; value: string }> {
  const pairs: Array<{ key: string; value: string }> = [];
  const re = /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    pairs.push({ key: m[1], value });
  }
  return pairs;
}

/** Parses a Dockerfile into discovered ENV/ARG variables. */
export function parseDockerfile(content: string, file: string): AdapterVar[] {
  const vars: AdapterVar[] = [];

  for (const { text, line } of logicalLines(content)) {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const instr = /^(\w+)\s+(.*)$/.exec(trimmed);
    if (!instr) continue;
    const keyword = instr[1].toUpperCase();
    const args = instr[2].trim();
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
