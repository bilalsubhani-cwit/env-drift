/**
 * Runtime environment validation. Unlike the CLI, this runs inside the
 * application at startup: it validates the process environment against the
 * contract, coerces values to their declared types, wraps secrets so they
 * cannot be accidentally logged, and — by default — fails before the app
 * begins accepting traffic.
 *
 * It only ever exposes variables declared in the contract; stray keys in
 * `process.env` are not surfaced.
 */

import type { Contract, EnvironmentName, VariableDef, Severity } from '../types.js';
import { validateValue, coerceBoolean } from '../engine/rules.js';
import { SecretValue } from '../engine/redact.js';

/** A coerced, typed runtime value. */
export type LoadedValue = string | number | boolean | string[] | SecretValue | undefined;

/** Per-environment behaviour when validation fails. */
export type FailureAction = 'off' | 'warn' | 'error';

export interface LoadOptions {
  contract: Contract;
  environment: EnvironmentName;
  /** The raw source of values; defaults to `process.env`. */
  source?: Record<string, string | undefined>;
  /** Restrict to variables consumed by this service (monorepo support). */
  service?: string;
  /** What to do on validation failure, per environment. */
  failurePolicy?: Partial<Record<EnvironmentName, FailureAction>>;
}

const DEFAULT_ACTION: FailureAction = 'error';

/** Coerces a raw string to the variable's declared runtime type. */
function coerce(def: VariableDef, value: string): LoadedValue {
  switch (def.type) {
    case 'integer':
    case 'port':
      return parseInt(value, 10);
    case 'number':
      return Number(value);
    case 'boolean':
      return coerceBoolean(value) ?? false;
    case 'json':
      try {
        return JSON.parse(value) as LoadedValue;
      } catch {
        return value;
      }
    case 'list':
      return value.split(def.separator ?? ',').map((p) => p.trim()).filter(Boolean);
    case 'secret':
      return new SecretValue(value);
    default:
      return def.secret ? new SecretValue(value) : value;
  }
}

/** Thrown when validation fails under an `error` policy. */
export class EnvironmentValidationError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`environment validation failed:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvironmentValidationError';
    this.issues = issues;
  }
}

/**
 * Validates and loads the environment. Returns a frozen, typed, secret-aware
 * object restricted to declared variables.
 *
 * @throws EnvironmentValidationError when validation fails and the
 *   environment's failure policy is `error` (the default for non-local
 *   environments).
 */
export function loadEnvironment(opts: LoadOptions): Readonly<Record<string, LoadedValue>> {
  const source = opts.source ?? (process.env as Record<string, string | undefined>);
  const action: FailureAction =
    opts.failurePolicy?.[opts.environment] ??
    (opts.environment === 'local' || opts.environment === 'development' ? 'warn' : DEFAULT_ACTION);

  const out: Record<string, LoadedValue> = {};
  const issues: string[] = [];

  for (const [name, def] of Object.entries(opts.contract.variables)) {
    // Skip variables this service does not consume.
    if (opts.service && def.consumers && !def.consumers.includes(opts.service)) continue;

    const raw = source[name];

    if (raw === undefined || raw === '') {
      if (def.requiredIn?.includes(opts.environment)) {
        issues.push(`"${name}" is required in ${opts.environment} but is missing`);
      } else if (def.default !== undefined) {
        out[name] = coerce(def, String(def.default));
      }
      continue;
    }

    const problems = validateValue(def, raw, opts.environment);
    const blocking = problems.filter((p) => severityFor(def, p.code) !== 'off');
    for (const p of blocking) issues.push(`"${name}": ${p.message}`);

    out[name] = coerce(def, raw);
  }

  if (issues.length > 0) {
    if (action === 'error') throw new EnvironmentValidationError(issues);
    if (action === 'warn') {
      for (const i of issues) console.warn(`[env-drift] ${i}`);
    }
  }

  return Object.freeze(out);
}

/** A variable's contract-level severity override, else a sensible default. */
function severityFor(def: VariableDef, _code: string): Severity {
  return def.severity ?? 'error';
}
