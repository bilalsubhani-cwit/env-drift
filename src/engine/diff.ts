/**
 * Policy-aware comparison between two environments. Unlike a naive diff, this
 * only reports differences that violate a declared policy: values that must
 * differ but are identical (`ENV008`), and values that must match but differ
 * (`ENV011`). Intentional, unconstrained differences are not reported.
 *
 * Values are compared without being revealed; secret values never appear in
 * the resulting messages.
 */

import type { Contract, EnvironmentName, Finding } from '../types.js';
import { compareValues } from './redact.js';

/** True if the unordered pair {a,b} is listed in `pairs`. */
function pairListed(
  pairs: Array<[EnvironmentName, EnvironmentName]> | undefined,
  a: EnvironmentName,
  b: EnvironmentName,
): boolean {
  return !!pairs?.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Compares two environments under the contract's difference policies. */
export function diffEnvironments(
  contract: Contract,
  envA: EnvironmentName,
  valuesA: Record<string, string>,
  envB: EnvironmentName,
  valuesB: Record<string, string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const [name, def] of Object.entries(contract.variables)) {
    const diffs = def.differences;
    if (!diffs) continue;

    const a = valuesA[name];
    const b = valuesB[name];
    const cmp = compareValues(a, b);

    if (pairListed(diffs.mustDifferBetween, envA, envB) && cmp === 'same') {
      findings.push({
        code: 'ENV008',
        severity: def.severity ?? 'error',
        message: `"${name}" must differ between ${envA} and ${envB} but the values are identical`,
        variable: name,
      });
    }

    if (pairListed(diffs.mustMatchBetween, envA, envB) && cmp === 'different') {
      findings.push({
        code: 'ENV011',
        severity: def.severity ?? 'error',
        message: `"${name}" must match between ${envA} and ${envB} but the values differ`,
        variable: name,
      });
    }
  }

  findings.sort((x, y) => x.code.localeCompare(y.code) || (x.variable ?? '').localeCompare(y.variable ?? ''));
  return findings;
}
