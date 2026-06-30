/**
 * JSON reporter. Emits a stable, machine-readable shape suitable for
 * dashboards and CI gating. The shape is part of the compatibility contract
 * (see SECURITY/README): field names and the `ENV###` codes do not change
 * across minor versions. No values are included — only redacted messages.
 */

import type { DriftReport } from '../types.js';

/** Serializes a report to a stable JSON string. */
export function renderJson(report: DriftReport, opts: { pretty?: boolean } = {}): string {
  const payload = {
    tool: 'envcanary',
    schemaVersion: 1,
    status: report.status,
    environment: report.environment ?? null,
    summary: report.summary,
    findings: report.findings.map((f) => ({
      code: f.code,
      severity: f.severity,
      message: f.message,
      variable: f.variable ?? null,
      environment: f.environment ?? null,
      service: f.service ?? null,
      location: f.location ?? null,
    })),
    suppressed: report.suppressed.map((f) => ({
      code: f.code,
      variable: f.variable ?? null,
      reason: f.suppressionReason ?? null,
    })),
  };
  return JSON.stringify(payload, null, opts.pretty ? 2 : 0);
}
