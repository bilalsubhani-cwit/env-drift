/**
 * Next.js (and Vite) build-manifest adapter — detects build/runtime drift
 * (`ENV009`).
 *
 * Public variables (`NEXT_PUBLIC_*`, `VITE_*`, …) are compiled into the client
 * bundle at build time. Changing the server's runtime environment afterward
 * does not change what is already baked into the built JavaScript. So a build
 * promoted from staging to production can serve the *staging* public values to
 * the browser even though the server reads the production ones.
 *
 * `writeManifest` records, at build time, a fingerprint of each public value
 * and the environment it was built for. `checkManifest` compares that manifest
 * against the target environment at deploy/startup and reports `ENV009` when a
 * rebuild is required. Public values are non-secret by definition, but the
 * manifest still stores only a hash — never the raw value.
 */

import { createHash } from 'node:crypto';

import type { Contract, EnvironmentName, Finding, Severity } from '../../types.js';
import { CODES } from '../../codes.js';

/** Prefixes that expose a value to the client bundle at build time. */
const CLIENT_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'PUBLIC_', 'EXPO_PUBLIC_', 'GATSBY_'];

/** The build manifest shape (stable; written at build, read at deploy). */
export interface BuildManifest {
  tool: 'envcanary';
  manifestVersion: 1;
  buildId: string;
  environment: EnvironmentName;
  contractVersion: number;
  /** Public variable name → fingerprint of the compiled value. */
  publicVariables: Record<string, string>;
}

/** Fingerprint for a public (non-secret) value. */
function fingerprintPublic(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/** True when a name is client-exposed by prefix or by contract `exposure`. */
function isPublic(name: string, contract: Contract): boolean {
  if (CLIENT_PREFIXES.some((p) => name.startsWith(p))) return true;
  return contract.variables[name]?.exposure === 'client';
}

function severityFor(contract: Contract, name: string): Severity {
  return contract.variables[name]?.severity ?? CODES.ENV009.defaultSeverity;
}

/** Collects the public variable names present in `values` (and/or contract). */
function publicNames(contract: Contract, values: Record<string, string>): string[] {
  const names = new Set<string>();
  for (const name of Object.keys(values)) if (isPublic(name, contract)) names.add(name);
  for (const name of Object.keys(contract.variables)) {
    if (isPublic(name, contract) && values[name] !== undefined) names.add(name);
  }
  return [...names];
}

/**
 * Produces a build manifest from the values compiled into a build. `buildId`
 * is supplied by the caller (e.g. a CI build number or git SHA) so the result
 * is deterministic.
 */
export function writeManifest(input: {
  contract: Contract;
  environment: EnvironmentName;
  values: Record<string, string>;
  buildId: string;
}): BuildManifest {
  const publicVariables: Record<string, string> = {};
  for (const name of publicNames(input.contract, input.values)) {
    publicVariables[name] = fingerprintPublic(input.values[name]);
  }
  return {
    tool: 'envcanary',
    manifestVersion: 1,
    buildId: input.buildId,
    environment: input.environment,
    contractVersion: input.contract.contractVersion,
    publicVariables,
  };
}

/**
 * Compares a build manifest against the target environment's values, reporting
 * `ENV009` where the compiled public value no longer matches what the target
 * expects — meaning a rebuild (not a restart) is required.
 */
export function checkManifest(input: {
  manifest: BuildManifest;
  contract: Contract;
  environment: EnvironmentName;
  values: Record<string, string>;
}): Finding[] {
  const { manifest, contract, environment, values } = input;
  const findings: Finding[] = [];
  const builtFor = manifest.environment;

  // Every public value baked into the build must still match the target.
  for (const [name, builtFingerprint] of Object.entries(manifest.publicVariables)) {
    const current = values[name];
    if (current === undefined) {
      findings.push({
        code: 'ENV009',
        severity: severityFor(contract, name),
        message: `"${name}" was compiled into the build (built for ${builtFor}) but is absent in ${environment}; a rebuild is required`,
        variable: name,
        environment,
      });
      continue;
    }
    if (fingerprintPublic(current) !== builtFingerprint) {
      findings.push({
        code: 'ENV009',
        severity: severityFor(contract, name),
        message: `"${name}" was compiled with the ${builtFor} value but the ${environment} value differs; a rebuild is required (restarting will not fix this)`,
        variable: name,
        environment,
      });
    }
  }

  // A public value the target expects but the build never compiled in.
  for (const name of publicNames(contract, values)) {
    if (!(name in manifest.publicVariables)) {
      findings.push({
        code: 'ENV009',
        severity: severityFor(contract, name),
        message: `"${name}" is expected at runtime in ${environment} but was not present at build time; a rebuild is required`,
        variable: name,
        environment,
      });
    }
  }

  findings.sort((a, b) => (a.variable ?? '').localeCompare(b.variable ?? ''));
  return findings;
}
