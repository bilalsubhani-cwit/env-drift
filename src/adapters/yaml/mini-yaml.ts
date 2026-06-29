/**
 * A zero-dependency YAML subset parser — just enough of block-style YAML to
 * read Docker Compose files (nested mappings, sequences, and scalars).
 *
 * Supported: block mappings (`key: value`), block sequences (`- item`),
 * nested structure by indentation, `#` comments, single/double-quoted scalars,
 * and simple inline `[a, b]` sequences. **Not** supported: anchors/aliases,
 * multi-document streams, flow mappings (`{a: b}`), block scalars (`|`/`>`),
 * and complex keys. This is deliberately narrow; it parses the shapes Compose
 * uses for `environment`, `env_file`, and `build.args`, and nothing more.
 */

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue } | null;

interface Line {
  indent: number;
  content: string;
  line: number;
}

/** Strips a trailing `# comment` that is preceded by whitespace or at start. */
function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** Tokenizes source into indented, comment-free, non-blank lines. */
function toLines(src: string): Line[] {
  const out: Line[] = [];
  const rawLines = src.replace(/^﻿/, '').split(/\r?\n/);
  rawLines.forEach((raw, idx) => {
    const noComment = stripComment(raw);
    if (noComment.trim() === '') return;
    if (noComment.trim() === '---') return; // document marker — ignore
    const indent = noComment.length - noComment.trimStart().length;
    out.push({ indent, content: noComment.trim(), line: idx + 1 });
  });
  return out;
}

/** Unquotes and lightly normalizes a scalar; parses simple inline sequences. */
function parseScalar(s: string): YamlValue {
  const t = s.trim();
  if (t === '' || t === '~' || t === 'null') return null;

  // Inline sequence: [a, b, c]
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((p) => parseScalar(p));
  }

  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

class Parser {
  private pos = 0;
  constructor(private readonly lines: Line[]) {}

  private peek(): Line | undefined {
    return this.lines[this.pos];
  }

  /** Parses a node whose content is indented at least `minIndent`. */
  parseNode(minIndent: number): YamlValue {
    const first = this.peek();
    if (!first || first.indent < minIndent) return null;
    const indent = first.indent;
    return first.content.startsWith('- ') || first.content === '-'
      ? this.parseSequence(indent)
      : this.parseMapping(indent);
  }

  private parseSequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent || !(line.content === '-' || line.content.startsWith('- '))) break;
      this.pos++;
      const rest = line.content === '-' ? '' : line.content.slice(2).trim();
      if (rest === '') {
        items.push(this.parseNode(indent + 1));
      } else {
        // Compose uses scalar list items (`- KEY=value`); deeper structure is
        // out of the supported subset and is read as a scalar string.
        items.push(parseScalar(rest));
      }
    }
    return items;
  }

  private parseMapping(indent: number): { [key: string]: YamlValue } {
    const map: { [key: string]: YamlValue } = {};
    for (;;) {
      const line = this.peek();
      if (!line || line.indent !== indent || line.content.startsWith('- ')) break;
      this.pos++;
      const colon = findColon(line.content);
      if (colon === -1) {
        // A bare scalar where a mapping was expected; ignore for our subset.
        continue;
      }
      const key = unquoteKey(line.content.slice(0, colon).trim());
      const rest = line.content.slice(colon + 1).trim();
      map[key] = rest === '' ? this.parseNode(indent + 1) : parseScalar(rest);
    }
    return map;
  }
}

/** Index of the key/value separating colon (a `:` followed by space or EOL). */
function findColon(s: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === ':' && !inSingle && !inDouble && (i + 1 === s.length || s[i + 1] === ' ')) {
      return i;
    }
  }
  return -1;
}

function unquoteKey(k: string): string {
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    return k.slice(1, -1);
  }
  return k;
}

/** Parses a YAML subset document into a nested JS value. */
export function parseYaml(src: string): YamlValue {
  const lines = toLines(src);
  if (lines.length === 0) return null;
  return new Parser(lines).parseNode(0);
}
