/**
 * Monorepo / multi-service support. When the contract declares `services` with
 * `consumers` / `producers` per variable, env-drift scans each service's code
 * separately and reports cross-service drift:
 *
 * - A declared consumer that never references the variable (`ENV011`), or — for
 *   a secret — a service granted a secret it does not use (`ENV013`, scope).
 * - A service that references a variable but is not a declared consumer
 *   (`ENV011`).
 *
 * These are configuration-hygiene signals, so they default to `warning`; a
 * variable's `severity` still overrides. Services with dynamic env access are
 * never accused of *not* using a variable — that cannot be proven statically.
 */

import { join } from 'node:path';

import type { Contract, CodeReference, Finding, Severity } from '../types.js';
import { scanProjectCode } from '../scan/discover.js';

/** The references discovered within one service's root. */
export interface ServiceScan {
  service: string;
  references: CodeReference[];
}

/** What a service statically references, plus whether it uses dynamic access. */
interface ServiceUsage {
  staticKeys: Set<string>;
  dynamic: boolean;
}

/** Scans every declared service's `root` for environment references. */
export function scanServices(contract: Contract, root: string): ServiceScan[] {
  const out: ServiceScan[] = [];
  for (const [service, def] of Object.entries(contract.services ?? {})) {
    out.push({ service, references: scanProjectCode(join(root, def.root)) });
  }
  return out;
}

function usageByService(scans: ServiceScan[]): Map<string, ServiceUsage> {
  const map = new Map<string, ServiceUsage>();
  for (const s of scans) {
    const staticKeys = new Set<string>();
    let dynamic = false;
    for (const r of s.references) {
      if (r.dynamic || r.key === null) dynamic = true;
      else staticKeys.add(r.key);
    }
    map.set(s.service, { staticKeys, dynamic });
  }
  return map;
}

/** Cross-service checks default to `warning`; a `severity` override wins. */
function severityFor(sev: Severity | undefined): Severity {
  return sev ?? 'warning';
}

/**
 * Produces cross-service findings from per-service scans. Variables without a
 * `consumers` list are not checked (there is nothing to compare against).
 */
export function checkServices(contract: Contract, scans: ServiceScan[]): Finding[] {
  const usage = usageByService(scans);
  const findings: Finding[] = [];

  for (const [name, def] of Object.entries(contract.variables)) {
    const consumers = def.consumers;
    if (!consumers || consumers.length === 0) continue;

    const referencedBy = [...usage.entries()]
      .filter(([, u]) => u.staticKeys.has(name))
      .map(([s]) => s);

    // A declared consumer that does not reference the variable.
    for (const consumer of consumers) {
      const u = usage.get(consumer);
      if (!u) continue; // not a scanned service — nothing to assert
      if (u.staticKeys.has(name) || u.dynamic) continue; // used, or unprovable

      if (def.secret) {
        findings.push({
          code: 'ENV013',
          severity: severityFor(def.severity),
          message: `secret "${name}" is granted to service "${consumer}" but it never references the variable; reduce its scope`,
          variable: name,
          service: consumer,
        });
      } else {
        findings.push({
          code: 'ENV011',
          severity: severityFor(def.severity),
          message: `service "${consumer}" is a declared consumer of "${name}" but never references it`,
          variable: name,
          service: consumer,
        });
      }
    }

    // A service that references the variable but is not a declared consumer.
    for (const service of referencedBy) {
      if (!consumers.includes(service)) {
        findings.push({
          code: 'ENV011',
          severity: severityFor(def.severity),
          message: `service "${service}" references "${name}" but is not a declared consumer`,
          variable: name,
          service,
        });
      }
    }
  }

  findings.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.variable ?? '').localeCompare(b.variable ?? '') ||
      (a.service ?? '').localeCompare(b.service ?? ''),
  );
  return findings;
}
