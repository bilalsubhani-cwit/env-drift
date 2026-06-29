/**
 * The drift taxonomy. Each rule has a stable identifier, a short title, a
 * default severity, and a one-line description.
 *
 * **Stability contract:** identifiers and their meaning do not change across
 * minor versions. Teams suppress, trend, and gate CI on these codes, and they
 * appear in SARIF output — renaming or repurposing one is a breaking change.
 */

import type { DriftCode, Severity } from './types.js';

export interface CodeInfo {
  code: DriftCode;
  title: string;
  defaultSeverity: Severity;
  description: string;
}

export const CODES: Readonly<Record<DriftCode, CodeInfo>> = {
  ENV001: {
    code: 'ENV001',
    title: 'Missing required variable',
    defaultSeverity: 'error',
    description: 'A variable required in this environment is absent.',
  },
  ENV002: {
    code: 'ENV002',
    title: 'Undeclared variable',
    defaultSeverity: 'warning',
    description: 'A variable is present but not declared in the contract.',
  },
  ENV003: {
    code: 'ENV003',
    title: 'Unused variable',
    defaultSeverity: 'warning',
    description: 'A declared variable is not referenced anywhere in code.',
  },
  ENV004: {
    code: 'ENV004',
    title: 'Invalid value',
    defaultSeverity: 'error',
    description: "A value does not satisfy its declared type or constraints.",
  },
  ENV005: {
    code: 'ENV005',
    title: 'Duplicate definition',
    defaultSeverity: 'warning',
    description: 'The same key is defined more than once in one file.',
  },
  ENV006: {
    code: 'ENV006',
    title: 'Precedence conflict',
    defaultSeverity: 'warning',
    description: 'A higher-precedence source shadows a reviewed configuration.',
  },
  ENV007: {
    code: 'ENV007',
    title: 'Exposure violation',
    defaultSeverity: 'error',
    description: 'A secret or server value uses a client-exposed prefix.',
  },
  ENV008: {
    code: 'ENV008',
    title: 'Unsafe environment value',
    defaultSeverity: 'error',
    description: 'A value is technically valid but unsafe for this environment.',
  },
  ENV009: {
    code: 'ENV009',
    title: 'Build/runtime drift',
    defaultSeverity: 'error',
    description: 'A compiled build-time value differs from the deploy target.',
  },
  ENV010: {
    code: 'ENV010',
    title: 'Deprecated configuration',
    defaultSeverity: 'warning',
    description: 'A deprecated variable is still declared or deployed.',
  },
  ENV011: {
    code: 'ENV011',
    title: 'Cross-service drift',
    defaultSeverity: 'error',
    description: 'Services expect incompatible names or values for a variable.',
  },
  ENV012: {
    code: 'ENV012',
    title: 'Stale runtime configuration',
    defaultSeverity: 'warning',
    description: 'Configuration changed but the workload was not restarted.',
  },
  ENV013: {
    code: 'ENV013',
    title: 'Scope violation',
    defaultSeverity: 'error',
    description: 'A secret is available to environments/jobs that should not see it.',
  },
  ENV014: {
    code: 'ENV014',
    title: 'Provider uncertainty',
    defaultSeverity: 'warning',
    description: 'A source could not be queried, so its status is unknown.',
  },
  ENV015: {
    code: 'ENV015',
    title: 'Secret lifecycle violation',
    defaultSeverity: 'warning',
    description: 'A secret version or age exceeds its approved policy.',
  },
  ENV016: {
    code: 'ENV016',
    title: 'Platform portability issue',
    defaultSeverity: 'warning',
    description: 'Keys differ only by case and behave differently across platforms.',
  },
};

/** Returns the registry entry for a code. */
export function codeInfo(code: DriftCode): CodeInfo {
  return CODES[code];
}

/** Numeric weight for severity ordering. */
const SEVERITY_RANK: Record<Severity, number> = {
  off: 0,
  info: 1,
  warning: 2,
  error: 3,
};

/** Returns the higher of two severities. */
export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Compares two severities (`-1`, `0`, `1`). */
export function compareSeverity(a: Severity, b: Severity): number {
  return Math.sign(SEVERITY_RANK[a] - SEVERITY_RANK[b]);
}
