/**
 * A minimal JS/TS tokenizer — just enough to find environment-variable access
 * without a parser dependency. It correctly skips line and block comments and
 * reads string/template literals as single tokens, so accessor patterns are
 * never matched inside a comment or string, and bracket-access keys can be
 * read back from their string literal.
 *
 * This is intentionally not a full lexer: it does not validate syntax, track
 * regex literals precisely, or build an AST. It classifies enough of the byte
 * stream that the pattern matcher in `code-scanner.ts` can be precise about
 * what is and is not a static environment reference.
 */

export type TokenType = 'ident' | 'string' | 'template' | 'punct' | 'other';

export interface Token {
  type: TokenType;
  /** For `ident`/`punct`: the text. For `string`: the decoded literal value. */
  value: string;
  line: number;
  col: number;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** Tokenizes source text. Newlines advance `line`; columns are 1-based. */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (n = 1): void => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < src.length) {
    const c = src[i];

    // Whitespace.
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      advance();
      continue;
    }

    // Comments.
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') advance();
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      advance(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance();
      advance(2);
      continue;
    }

    // String literals.
    if (c === '"' || c === "'") {
      const startLine = line;
      const startCol = col;
      const quote = c;
      advance(); // opening quote
      let value = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          value += src[i + 1] ?? '';
          advance(2);
        } else {
          if (src[i] === '\n') {
            // Unterminated single/double-quoted string; stop at newline.
            break;
          }
          value += src[i];
          advance();
        }
      }
      advance(); // closing quote
      tokens.push({ type: 'string', value, line: startLine, col: startCol });
      continue;
    }

    // Template literals — read to the closing backtick (best-effort nesting of
    // `${ ... }`). The contents are not tokenized; a template used as a key is
    // treated as dynamic.
    if (c === '`') {
      const startLine = line;
      const startCol = col;
      advance();
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '\\') {
          advance(2);
          continue;
        }
        if (depth === 0 && src[i] === '`') {
          advance();
          break;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          depth++;
          advance(2);
          continue;
        }
        if (depth > 0 && src[i] === '}') {
          depth--;
          advance();
          continue;
        }
        advance();
      }
      tokens.push({ type: 'template', value: '', line: startLine, col: startCol });
      continue;
    }

    // Identifiers / keywords.
    if (IDENT_START.test(c)) {
      const startLine = line;
      const startCol = col;
      let value = '';
      while (i < src.length && IDENT_PART.test(src[i])) {
        value += src[i];
        advance();
      }
      tokens.push({ type: 'ident', value, line: startLine, col: startCol });
      continue;
    }

    // Structural punctuation we care about.
    if (c === '.' || c === '[' || c === ']' || c === '(' || c === ')' || c === '{' || c === '}' || c === '=' || c === ',') {
      tokens.push({ type: 'punct', value: c, line, col });
      advance();
      continue;
    }

    // Everything else (operators, etc.).
    tokens.push({ type: 'other', value: c, line, col });
    advance();
  }

  return tokens;
}
