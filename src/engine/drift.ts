/**
 * The drift engine. It correlates three views of configuration —
 *
 *   the contract  ⇄  the values present in an environment  ⇄  code references
 *
 * — and emits stable {@link Finding}s. Suppressions are applied last, severity
 * is resolved from the contract, and the overall {@link Status} is derived so
 * the CLI can pick a deterministic exit code.
 */

import { basename } from 'node:path';

import type {
  Contract,
  VariableDef,
  EnvironmentName,
  CodeReference,
  Finding,
  DriftReport,
  Status,
  Severity,
  DriftCode,
  Suppression,
  ParsedEnvFile,
} from '../types.js';
import { CODES } from '../codes.js';
import { validateValue } from './rules.js';
import { resolvePrecedence } from '../scan/precedence.js';
import { compareValues } from './redact.js';

/** Prefixes that expose a value to client/browser bundles. */
const CLIENT_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'PUBLIC_', 'EXPO_PUBLIC_', 'GATSBY_'];

/** Rules that may never be silenced by a suppression. */
const NON_SUPPRESSIBLE: ReadonlySet<DriftCode> = new Set(['ENV007']);

/** Inputs to a single-environment check. */
export interface CheckInput {
  contract: Contract;
  environment: EnvironmentName;
  /** Effective key→value map for the environment (e.g. parsed `.env`). */
  values: Record<string, string>;
  /** Optional code references, enabling unused/undeclared-in-code checks. */
  references?: CodeReference[];
  /**
   * Optional parsed `.env` files. When supplied, env-drift can report
   * duplicate keys (`ENV005`) and precedence shadowing (`ENV006`), which the
   * flattened `values` map cannot express.
   */
  files?: ParsedEnvFile[];
  /**
   * Findings produced outside the core engine (e.g. by source adapters) to be
   * merged in before suppression and status resolution.
   */
  extraFindings?: Finding[];
  /** Injected clock for deterministic deprecation/suppression expiry. */
  now?: Date;
}

/** Resolves the severity for a finding: contract override, else code default. */
function severityFor(def: VariableDef | undefined, code: DriftCode): Severity {
  if (def?.severity) return def.severity;
  return CODES[code].defaultSeverity;
}

/** True when `key` uses a client-exposed framework prefix. */
function hasClientPrefix(key: string): boolean {
  return CLIENT_PREFIXES.some((p) => key.startsWith(p));
}

/** Checks a single environment against the contract. */
export function checkEnvironment(input: CheckInput): DriftReport {
  const { contract, environment, values } = input;
  const now = input.now ?? new Date(0);
  const findings: Finding[] = [];
  const declared = contract.variables;

  for (const [name, def] of Object.entries(declared)) {
    const present = Object.prototype.hasOwnProperty.call(values, name);
    const value = values[name];

    // ENV001 — missing required.
    if (def.requiredIn?.includes(environment) && !present) {
      findings.push({
        code: 'ENV001',
        severity: severityFor(def, 'ENV001'),
        message: `required variable "${name}" is missing in ${environment}`,
        variable: name,
        environment,
      });
    }

    // forbiddenIn — present where it must not be.
    if (def.forbiddenIn?.includes(environment) && present) {
      findings.push({
        code: 'ENV008',
        severity: severityFor(def, 'ENV008'),
        message: `variable "${name}" must not be present in ${environment}`,
        variable: name,
        environment,
      });
    }

    // ENV007 — exposure violation (a secret/server value on a public prefix).
    if (hasClientPrefix(name) && (def.secret || def.exposure === 'server')) {
      findings.push({
        code: 'ENV007',
        severity: severityFor(def, 'ENV007'),
        message: `"${name}" uses a client-exposed prefix but is declared ${def.secret ? 'secret' : 'server-only'}`,
        variable: name,
        environment,
      });
    }

    // ENV004 / ENV008 — value validation (only when present).
    if (present) {
      for (const issue of validateValue(def, value, environment)) {
        findings.push({
          code: issue.code,
          severity: severityFor(def, issue.code),
          message: `"${name}": ${issue.message}`,
          variable: name,
          environment,
        });
      }
    }

    // ENV010 — deprecated configuration still present.
    if (def.deprecated && present) {
      const past = def.deprecated.removeAfter
        ? now.getTime() > Date.parse(def.deprecated.removeAfter)
        : false;
      const repl = def.deprecated.replacement ? `; use "${def.deprecated.replacement}"` : '';
      findings.push({
        code: 'ENV010',
        severity: past ? 'error' : severityFor(def, 'ENV010'),
        message: `"${name}" is deprecated${past ? ' and past its removal date' : ''}${repl}`,
        variable: name,
        environment,
      });
    }
  }

  // ENV002 — undeclared variables present in the environment.
  for (const key of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(declared, key)) {
      findings.push({
        code: 'ENV002',
        severity: CODES.ENV002.defaultSeverity,
        message: `"${key}" is present but not declared in the contract`,
        variable: key,
        environment,
      });
    }
  }

  // ENV016 — keys that collide only by case (platform-portability hazard).
  findings.push(...caseCollisions(Object.keys(values), environment));

  // ENV005 / ENV006 — only computable from parsed files with provenance.
  if (input.files && input.files.length) {
    findings.push(...duplicateFindings(input.files, declared, environment));
    findings.push(...precedenceFindings(input.files, declared, environment));
  }

  // Code-correlation checks, when references are supplied.
  if (input.references) {
    findings.push(...correlateCode(contract, input.references));
  }

  // Findings from source adapters (Docker, Next.js, …).
  if (input.extraFindings) findings.push(...input.extraFindings);

  return finalize(findings, contract.suppressions ?? [], environment, now);
}

/** ENV005 — keys defined more than once within a single file. */
function duplicateFindings(
  files: ParsedEnvFile[],
  declared: Record<string, VariableDef>,
  environment: EnvironmentName,
): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    for (const e of f.entries) {
      if (!e.duplicate) continue;
      out.push({
        code: 'ENV005',
        severity: severityFor(declared[e.key], 'ENV005'),
        message: `"${e.key}" is defined more than once in ${basename(f.file)}`,
        variable: e.key,
        environment,
        location: e.location,
      });
    }
  }
  return out;
}

/**
 * ENV006 — an unreviewed local-override file shadows a committed value with a
 * different one. Intentional layering of committed files is not flagged, and
 * values are never shown (only the file names).
 */
function precedenceFindings(
  files: ParsedEnvFile[],
  declared: Record<string, VariableDef>,
  environment: EnvironmentName,
): Finding[] {
  const { provenance } = resolvePrecedence(files, environment);
  const out: Finding[] = [];
  for (const p of provenance) {
    if (!p.winner.isLocal) continue; // only a local override is suspicious
    const conflicting = p.shadowed.filter(
      (d) => !d.isLocal && compareValues(d.value, p.winner.value) === 'different',
    );
    if (!conflicting.length) continue;
    const shadowed = conflicting.map((c) => basename(c.file)).join(', ');
    out.push({
      code: 'ENV006',
      severity: severityFor(declared[p.key], 'ENV006'),
      message: `"${p.key}" from ${basename(p.winner.file)} (local override) shadows the reviewed value in ${shadowed}`,
      variable: p.key,
      environment,
      location: p.winner.location,
    });
  }
  return out;
}

/** ENV016 — detects keys that differ only by case. */
function caseCollisions(keys: string[], environment: EnvironmentName): Finding[] {
  const byLower = new Map<string, string[]>();
  for (const k of keys) {
    const lower = k.toLowerCase();
    const group = byLower.get(lower);
    if (group) group.push(k);
    else byLower.set(lower, [k]);
  }
  const out: Finding[] = [];
  for (const group of byLower.values()) {
    if (group.length > 1) {
      out.push({
        code: 'ENV016',
        severity: CODES.ENV016.defaultSeverity,
        message: `keys differ only by case and behave differently across platforms: ${group.join(', ')}`,
        environment,
      });
    }
  }
  return out;
}

/** ENV002/ENV003/ENV014 — correlates contract against code references. */
export function correlateCode(contract: Contract, references: CodeReference[]): Finding[] {
  const findings: Finding[] = [];
  const declared = new Set(Object.keys(contract.variables));
  const referenced = new Set<string>();
  let sawDynamic = false;

  for (const ref of references) {
    if (ref.dynamic || ref.key === null) {
      sawDynamic = true;
      findings.push({
        code: 'ENV014',
        severity: 'info',
        message: `dynamic environment access via ${ref.accessor}; static completeness cannot be guaranteed`,
        location: ref.location,
      });
      continue;
    }
    referenced.add(ref.key);
    if (!declared.has(ref.key)) {
      findings.push({
        code: 'ENV002',
        severity: CODES.ENV002.defaultSeverity,
        message: `"${ref.key}" is referenced in code but not declared in the contract`,
        variable: ref.key,
        location: ref.location,
      });
    }
  }

  // ENV003 — declared but never referenced. Suppressed when dynamic access
  // was seen, since the scanner cannot prove the variable is truly unused.
  if (!sawDynamic) {
    for (const name of declared) {
      if (!referenced.has(name)) {
        findings.push({
          code: 'ENV003',
          severity: CODES.ENV003.defaultSeverity,
          message: `"${name}" is declared in the contract but never referenced in code`,
          variable: name,
        });
      }
    }
  }

  return findings;
}

/** Applies suppressions, dedupes ENV002 (code + value can both report), sorts. */
function finalize(
  raw: Finding[],
  suppressions: Suppression[],
  environment: EnvironmentName | undefined,
  now: Date,
): DriftReport {
  const active: Finding[] = [];
  const suppressed: Finding[] = [];

  for (const f of raw) {
    if (f.severity === 'off') continue;
    const m = matchSuppression(f, suppressions, now);
    if (m && !NON_SUPPRESSIBLE.has(f.code)) {
      if (m.expired) {
        // Expired suppression no longer silences the finding; it re-surfaces at
        // its real severity (failing CI) with a note explaining why.
        active.push({ ...f, message: `${f.message} (suppression expired ${m.suppression.expiresAt})` });
      } else {
        suppressed.push({ ...f, suppressed: true, suppressionReason: m.suppression.reason });
      }
    } else {
      active.push(f);
    }
  }

  const summary = { error: 0, warning: 0, info: 0, unknown: 0 };
  for (const f of active) {
    if (f.code === 'ENV014') summary.unknown++;
    else if (f.severity === 'error') summary.error++;
    else if (f.severity === 'warning') summary.warning++;
    else if (f.severity === 'info') summary.info++;
  }

  let status: Status = 'PASS';
  if (summary.error > 0) status = 'FAIL';
  else if (summary.unknown > 0) status = 'UNKNOWN';
  else if (summary.warning > 0) status = 'WARNING';

  active.sort((a, b) => a.code.localeCompare(b.code) || (a.variable ?? '').localeCompare(b.variable ?? ''));

  return { status, findings: active, suppressed, summary, environment };
}

/** Finds a suppression matching a finding (expired or not), if any. */
function matchSuppression(
  finding: Finding,
  suppressions: Suppression[],
  now: Date,
): { suppression: Suppression; expired: boolean } | undefined {
  for (const s of suppressions) {
    if (s.rule !== finding.code) continue;
    if (s.variable && s.variable !== finding.variable) continue;
    if (s.environment && s.environment !== finding.environment) continue;
    const expired = !!s.expiresAt && now.getTime() > Date.parse(s.expiresAt);
    return { suppression: s, expired };
  }
  return undefined;
}
