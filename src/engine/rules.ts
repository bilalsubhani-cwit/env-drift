/**
 * Value validation. Given a variable declaration, a raw value, and the target
 * environment, this produces the type/constraint violations (`ENV004`) and the
 * environment-safety violations (`ENV008`) for that value.
 *
 * Cross-environment comparisons (`mustDifferBetween`, etc.) live in the engine,
 * not here — this module only ever sees one value at a time.
 */

import type { VariableDef, EnvironmentName, EnvRules, DriftCode } from '../types.js';

/** A single rule violation: a code plus a human-readable message. */
export interface RuleIssue {
  code: DriftCode;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DURATION_RE = /^\d+(\.\d+)?\s*(ms|s|m|h|d)$/i;

/** Coerces common truthy/falsy spellings to a boolean, or `null` if invalid. */
export function coerceBoolean(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return null;
}

/** Parses a URL, returning `null` when it is not a valid absolute URL. */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Type and base-constraint validation. Pushes `ENV004` issues. */
function validateType(def: VariableDef, value: string, issues: RuleIssue[]): void {
  const bad = (message: string): void => {
    issues.push({ code: 'ENV004', message });
  };

  switch (def.type) {
    case 'integer': {
      if (!/^-?\d+$/.test(value.trim())) return bad(`expected an integer, got "${value}"`);
      const n = Number(value);
      if (def.min !== undefined && n < def.min) bad(`must be >= ${def.min}`);
      if (def.max !== undefined && n > def.max) bad(`must be <= ${def.max}`);
      break;
    }
    case 'number': {
      const n = Number(value);
      if (value.trim() === '' || Number.isNaN(n)) return bad(`expected a number, got "${value}"`);
      if (def.min !== undefined && n < def.min) bad(`must be >= ${def.min}`);
      if (def.max !== undefined && n > def.max) bad(`must be <= ${def.max}`);
      break;
    }
    case 'boolean':
      if (coerceBoolean(value) === null) bad(`expected a boolean, got "${value}"`);
      break;
    case 'port': {
      if (!/^\d+$/.test(value.trim())) return bad(`expected a port number, got "${value}"`);
      const n = Number(value);
      const min = def.min ?? 1;
      const max = def.max ?? 65535;
      if (n < min || n > max) bad(`port must be between ${min} and ${max}`);
      break;
    }
    case 'url': {
      const u = parseUrl(value);
      if (!u) return bad(`expected a URL, got "${value}"`);
      if (def.allowedProtocols && !def.allowedProtocols.includes(u.protocol)) {
        bad(`protocol "${u.protocol}" not allowed (expected ${def.allowedProtocols.join(', ')})`);
      }
      break;
    }
    case 'email':
      if (!EMAIL_RE.test(value)) bad(`expected an email address, got "${value}"`);
      break;
    case 'enum':
      if (def.values && !def.values.includes(value)) {
        bad(`must be one of ${def.values.map((v) => `"${v}"`).join(', ')}`);
      }
      break;
    case 'json':
      try {
        JSON.parse(value);
      } catch {
        bad('expected valid JSON');
      }
      break;
    case 'list': {
      const sep = def.separator ?? ',';
      if (value.split(sep).every((p) => p.trim() === '')) bad('expected a non-empty list');
      break;
    }
    case 'duration':
      if (!DURATION_RE.test(value.trim())) bad(`expected a duration like "30s" or "5m", got "${value}"`);
      break;
    case 'secret':
    case 'string':
    case 'custom':
      break;
  }

  // String-shaped constraints apply to most types.
  if (def.minLength !== undefined && value.length < def.minLength) {
    bad(`must be at least ${def.minLength} characters`);
  }
  if (def.maxLength !== undefined && value.length > def.maxLength) {
    bad(`must be at most ${def.maxLength} characters`);
  }
  if (def.pattern && !new RegExp(def.pattern).test(value)) {
    bad(`does not match required pattern /${def.pattern}/`);
  }
  if (def.forbiddenValues && def.forbiddenValues.includes(value)) {
    // A placeholder/known-bad literal. For secrets we never echo the value.
    const shown = def.secret ? 'a forbidden placeholder value' : `the forbidden value "${value}"`;
    bad(`must not be ${shown}`);
  }
  if (def.validate) {
    const msg = def.validate(value);
    if (msg) bad(msg);
  }
}

/** Applies environment-specific safety rules. Pushes `ENV008` issues. */
function validateEnvRules(rules: EnvRules, value: string, issues: RuleIssue[]): void {
  const unsafe = (message: string): void => {
    issues.push({ code: 'ENV008', message });
  };

  const url = parseUrl(value);
  if (url) {
    if (rules.requireHttps && url.protocol !== 'https:') {
      unsafe('must use https in this environment');
    }
    if (rules.allowedProtocols && !rules.allowedProtocols.includes(url.protocol)) {
      unsafe(`protocol "${url.protocol}" is not allowed in this environment`);
    }
    const host = url.hostname.toLowerCase();
    if (rules.forbiddenHosts && rules.forbiddenHosts.map((h) => h.toLowerCase()).includes(host)) {
      unsafe(`host "${url.hostname}" is not allowed in this environment`);
    }
    if (rules.allowedHosts && !rules.allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
      unsafe(`host "${url.hostname}" is not in the allowed set for this environment`);
    }
  }

  if (rules.forbiddenValues && rules.forbiddenValues.includes(value)) {
    unsafe('value is not permitted in this environment');
  }

  if (rules.allowedValues) {
    const coerced = coerceForCompare(value);
    const ok = rules.allowedValues.some((a) => compareCoerced(coerced, a));
    if (!ok) unsafe(`value is not in the allowed set for this environment`);
  }

  if (rules.min !== undefined || rules.max !== undefined) {
    const n = Number(value);
    if (!Number.isNaN(n)) {
      if (rules.min !== undefined && n < rules.min) unsafe(`must be >= ${rules.min} in this environment`);
      if (rules.max !== undefined && n > rules.max) unsafe(`must be <= ${rules.max} in this environment`);
    }
  }

  if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
    unsafe(`does not match the required pattern for this environment`);
  }
}

/** Normalizes a raw value to string/number/boolean for `allowedValues` checks. */
function coerceForCompare(value: string): string | number | boolean {
  const b = coerceBoolean(value);
  if (b !== null && /^(true|false|yes|no|on|off|0|1)$/i.test(value.trim())) return b;
  const n = Number(value);
  if (value.trim() !== '' && !Number.isNaN(n)) return n;
  return value;
}

function compareCoerced(value: string | number | boolean, allowed: string | number | boolean): boolean {
  if (typeof allowed === 'boolean') return coerceBoolean(String(value)) === allowed || value === allowed;
  return value === allowed || String(value) === String(allowed);
}

/**
 * Validates a single value against its declaration for a given environment.
 * Returns every issue found (may be empty).
 */
export function validateValue(
  def: VariableDef,
  value: string,
  environment: EnvironmentName,
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  validateType(def, value, issues);
  const envRules = def.rules?.[environment];
  if (envRules) validateEnvRules(envRules, value, issues);
  return issues;
}
