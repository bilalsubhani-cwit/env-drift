/**
 * Human-readable terminal reporter. Output is plain text with optional ANSI
 * colour (disabled automatically when not writing to a TTY). It never prints a
 * variable value — the engine only ever produces redacted messages.
 */

import type { DriftReport, Finding, Status } from '../types.js';
import { CODES } from '../codes.js';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

type Palette = typeof COLORS;

function palette(useColor: boolean): Palette {
  if (useColor) return COLORS;
  return Object.fromEntries(Object.keys(COLORS).map((k) => [k, ''])) as Palette;
}

const STATUS_GLYPH: Record<Status, string> = {
  PASS: '✓',
  WARNING: '!',
  FAIL: '✗',
  UNKNOWN: '?',
  SKIPPED: '–',
};

function colorFor(c: Palette, finding: Finding): string {
  if (finding.code === 'ENV014') return c.cyan;
  if (finding.severity === 'error') return c.red;
  if (finding.severity === 'warning') return c.yellow;
  return c.dim;
}

function formatLocation(finding: Finding): string {
  if (!finding.location) return '';
  const { file, line, column } = finding.location;
  return ` (${file}:${line}${column ? `:${column}` : ''})`;
}

/** Renders a report as a terminal string. */
export function renderTerminal(
  report: DriftReport,
  opts: { color?: boolean } = {},
): string {
  const envNoColor = typeof process !== 'undefined' && !!process.env?.NO_COLOR;
  const useColor = opts.color ?? (!envNoColor && typeof process !== 'undefined' && !!process.stdout?.isTTY);
  const c = palette(useColor);
  const lines: string[] = [];

  const header = report.environment ? `envcanary — ${report.environment}` : 'envcanary';
  lines.push(`${c.bold}${header}${c.reset}`);
  lines.push('');

  if (report.findings.length === 0) {
    lines.push(`${c.green}${STATUS_GLYPH.PASS} No drift detected.${c.reset}`);
  } else {
    for (const f of report.findings) {
      const col = colorFor(c, f);
      const info = CODES[f.code];
      lines.push(
        `${col}${f.code}${c.reset} ${c.dim}${info.title}${c.reset}${c.dim}${formatLocation(f)}${c.reset}`,
      );
      lines.push(`  ${f.message}`);
    }
  }

  if (report.suppressed.length > 0) {
    lines.push('');
    lines.push(`${c.dim}Suppressed (${report.suppressed.length}):${c.reset}`);
    for (const f of report.suppressed) {
      lines.push(`  ${c.dim}${f.code} ${f.variable ?? ''} — ${f.suppressionReason ?? ''}${c.reset}`);
    }
  }

  lines.push('');
  const { error, warning, info, unknown } = report.summary;
  const statusColor =
    report.status === 'FAIL' ? c.red : report.status === 'WARNING' ? c.yellow : report.status === 'UNKNOWN' ? c.cyan : c.green;
  lines.push(
    `${statusColor}${STATUS_GLYPH[report.status]} ${report.status}${c.reset} ` +
      `${c.dim}—${c.reset} ${error} error, ${warning} warning, ${info} info, ${unknown} unknown`,
  );

  return lines.join('\n');
}
