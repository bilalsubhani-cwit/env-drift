/**
 * Reporter selection and exit-code mapping.
 */

import type { DriftReport, Finding, EnvironmentName } from '../types.js';
import { renderTerminal } from './terminal.js';
import { renderJson } from './json.js';
import { renderSarif } from './sarif.js';

export { renderTerminal } from './terminal.js';
export { renderJson } from './json.js';
export { renderSarif } from './sarif.js';

/** Supported output formats. `junit` is reserved for a future release. */
export type ReportFormat = 'terminal' | 'json' | 'sarif';

/**
 * Builds a {@link DriftReport} from a flat list of findings (no suppression
 * pass). Used by commands that produce findings directly — `diff`, `manifest`.
 */
export function reportFromFindings(findings: Finding[], environment?: EnvironmentName): DriftReport {
  const summary = { error: 0, warning: 0, info: 0, unknown: 0 };
  for (const f of findings) {
    if (f.code === 'ENV014') summary.unknown++;
    else if (f.severity === 'error') summary.error++;
    else if (f.severity === 'warning') summary.warning++;
    else if (f.severity === 'info') summary.info++;
  }
  let status: DriftReport['status'] = 'PASS';
  if (summary.error > 0) status = 'FAIL';
  else if (summary.unknown > 0) status = 'UNKNOWN';
  else if (summary.warning > 0) status = 'WARNING';

  return { status, findings, suppressed: [], summary, environment };
}

/** Renders a report in the requested format. */
export function render(report: DriftReport, format: ReportFormat): string {
  switch (format) {
    case 'json':
      return renderJson(report, { pretty: true });
    case 'sarif':
      return renderSarif(report);
    case 'terminal':
    default:
      return renderTerminal(report);
  }
}

/**
 * Maps a report to a deterministic process exit code:
 *
 * - `0` — no blocking drift
 * - `1` — policy violations (one or more errors)
 * - `4` — incomplete result (one or more UNKNOWNs)
 *
 * Exit codes `2` (invalid contract / parse failure) and `3` (provider
 * auth/connectivity) are set directly by the CLI, since they precede a report.
 */
export function reportExitCode(report: DriftReport): number {
  if (report.summary.error > 0) return 1;
  if (report.summary.unknown > 0) return 4;
  return 0;
}
