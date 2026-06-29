/**
 * SARIF 2.1.0 reporter. SARIF is an OASIS standard for static-analysis
 * results, and GitHub can ingest third-party SARIF into code scanning, so a
 * finding with a source location can surface directly on a pull request.
 *
 * Severity maps to SARIF `level`: error→`error`, warning→`warning`,
 * info/unknown→`note`.
 */

import type { DriftReport, Finding, Severity } from '../types.js';
import { CODES } from '../codes.js';

const SARIF_LEVEL: Record<Severity, 'error' | 'warning' | 'note' | 'none'> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
  off: 'none',
};

function levelFor(f: Finding): 'error' | 'warning' | 'note' | 'none' {
  if (f.code === 'ENV014') return 'note';
  return SARIF_LEVEL[f.severity];
}

function resultFor(f: Finding): unknown {
  const result: Record<string, unknown> = {
    ruleId: f.code,
    level: levelFor(f),
    message: { text: f.message },
  };
  if (f.location) {
    result.locations = [
      {
        physicalLocation: {
          artifactLocation: { uri: toUri(f.location.file) },
          region: {
            startLine: Math.max(1, f.location.line),
            ...(f.location.column ? { startColumn: f.location.column } : {}),
          },
        },
      },
    ];
  }
  return result;
}

/** Normalizes a filesystem path to a forward-slash relative URI. */
function toUri(file: string): string {
  return file.replace(/\\/g, '/');
}

/** Serializes a report to a SARIF 2.1.0 log string. */
export function renderSarif(report: DriftReport, version = '0.2.0'): string {
  const rules = Object.values(CODES).map((info) => ({
    id: info.code,
    name: info.title.replace(/\s+/g, ''),
    shortDescription: { text: info.title },
    fullDescription: { text: info.description },
    defaultConfiguration: { level: SARIF_LEVEL[info.defaultSeverity] },
  }));

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'env-drift',
            informationUri: 'https://github.com/cwit-ae/env-drift',
            version,
            rules,
          },
        },
        results: report.findings.map(resultFor),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
