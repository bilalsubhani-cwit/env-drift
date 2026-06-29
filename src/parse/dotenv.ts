/**
 * A zero-dependency dotenv parser.
 *
 * Handles the cases the README's "Parser correctness" checklist calls out:
 * single/double quotes, multiline quoted values, escaped characters,
 * `export ` prefixes, inline comments, empty values, duplicate keys, CRLF and
 * LF line endings, and a leading UTF-8 byte-order mark. It deliberately does
 * **not** perform `${VAR}` expansion — expansion is source-specific (a shell,
 * Compose, and Next.js each differ), so the raw written value is preserved and
 * expansion is left to source-aware adapters.
 */

import type { EnvEntry, ParsedEnvFile } from '../types.js';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A value-segment parsed out of the text, plus the line it ended on. */
interface ValueResult {
  value: string;
  endLine: number;
}

/** Strips a leading UTF-8 BOM, if present. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Applies double-quote escape sequences (`\n`, `\t`, `\r`, `\\`, `\"`, `\$`). */
function unescapeDouble(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === '\\') out += '\\';
      else if (n === '"') out += '"';
      else if (n === '$') out += '$';
      else out += n;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Reads a value starting at `lines[startLine]`, position `from`. Supports
 * quoted values that span multiple physical lines. Returns the value and the
 * index of the last line consumed.
 */
function readValue(lines: string[], startLine: number, from: string): ValueResult {
  const v = from.replace(/^[ \t]*/, '');

  const quote = v[0];
  if (quote === '"' || quote === "'") {
    // Collect characters until the matching, unescaped closing quote, which
    // may be on a later line. Single quotes are literal; double quotes honour
    // backslash escaping (resolved by `unescapeDouble` at the end).
    let body = '';
    let rest = v.slice(1);
    let line = startLine;
    const honourEscapes = quote === '"';

    for (;;) {
      let closed = false;
      for (let i = 0; i < rest.length; i++) {
        const c = rest[i];
        if (honourEscapes && c === '\\' && i + 1 < rest.length) {
          body += c + rest[i + 1]; // keep the escape pair for unescapeDouble
          i++;
          continue;
        }
        if (c === quote) {
          // Anything after the closing quote on this line is discarded.
          closed = true;
          break;
        }
        body += c;
      }
      if (closed) {
        return { value: honourEscapes ? unescapeDouble(body) : body, endLine: line };
      }
      // Not closed on this line — absorb a real newline and continue.
      body += '\n';
      line++;
      if (line >= lines.length) {
        // Unterminated quote: best-effort, return what we have.
        return { value: honourEscapes ? unescapeDouble(body) : body, endLine: lines.length - 1 };
      }
      rest = lines[line];
    }
  }

  // Unquoted: strip an inline comment that is preceded by whitespace, then
  // trim trailing whitespace. `a#b` is kept whole; `a # b` becomes `a`.
  let value = v;
  const hashIdx = findInlineComment(value);
  if (hashIdx !== -1) value = value.slice(0, hashIdx);
  value = value.replace(/[ \t]+$/, '');
  return { value, endLine: startLine };
}

/** Index of an inline `#` comment (one preceded by whitespace), or -1. */
function findInlineComment(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return i;
    }
  }
  return -1;
}

/**
 * Parses dotenv-style text into structured entries with source locations.
 *
 * @param content Raw file contents.
 * @param file    Path used for {@link EnvEntry.location}.
 */
export function parseDotenv(content: string, file: string): ParsedEnvFile {
  const lines = stripBom(content).split(/\r?\n/);
  const entries: EnvEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Strip a leading `export ` (shell-style) prefix.
    let work = raw.replace(/^[ \t]*/, '');
    let exported = false;
    if (/^export[ \t]+/.test(work)) {
      exported = true;
      work = work.replace(/^export[ \t]+/, '');
    }

    const eq = work.indexOf('=');
    if (eq === -1) continue; // not a key=value line

    const key = work.slice(0, eq).trim();
    if (!KEY_RE.test(key)) continue;

    const { value, endLine } = readValue(lines, i, work.slice(eq + 1));

    const entry: EnvEntry = {
      key,
      value,
      location: { file, line: i + 1 },
      exported,
    };
    if (seen.has(key)) entry.duplicate = true;
    seen.add(key);
    entries.push(entry);

    i = endLine; // skip lines absorbed by a multiline value
  }

  return { file, entries };
}

/**
 * Collapses parsed entries into an effective key→value map, where the last
 * definition of a key wins (dotenv semantics within a single file).
 */
export function toEnvMap(parsed: ParsedEnvFile): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of parsed.entries) map[e.key] = e.value;
  return map;
}
