/**
 * Secret-safe display helpers. The package routinely sits next to secret
 * material, so the default for anything that might be a secret is to show
 * **presence and shape, never the value**.
 *
 * Design rules enforced here (mirroring the README's "Secret-safe design"):
 * - Secret values are never returned in cleartext.
 * - Credentials embedded in URLs are redacted even for non-secret values.
 * - Persistent equality tokens use keyed HMAC, never a bare hash of a
 *   low-entropy value. In-memory comparison is preferred and exposes only
 *   `same` / `different` / `unknown`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The fixed mask shown in place of a secret value. */
export const SECRET_MASK = '••••••••';

/** Result of comparing two values without revealing either. */
export type ValueComparison = 'same' | 'different' | 'unknown';

/**
 * Masks a value for display. Secrets become a fixed mask. Non-secret values
 * have any embedded URL credentials redacted, and over-long values are
 * truncated so a value is never dumped wholesale into a report.
 */
export function maskValue(value: string, opts: { secret: boolean }): string {
  if (opts.secret) return SECRET_MASK;
  return truncate(redactUrlCredentials(value));
}

/** Replaces `user:password@` credentials inside a URL-ish string with `***`. */
export function redactUrlCredentials(value: string): string {
  // Matches scheme://user:pass@host — redacts the userinfo component.
  return value.replace(
    /(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:/?#\s]+):([^@/?#\s]+)@/g,
    (_m, scheme: string) => `${scheme}***:***@`,
  );
}

/** Truncates very long values for display, keeping a length hint. */
export function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}… (${value.length} chars)`;
}

/**
 * Compares two values in memory without revealing them. Returns `unknown`
 * when either value is absent.
 */
export function compareValues(
  a: string | undefined,
  b: string | undefined,
): ValueComparison {
  if (a === undefined || b === undefined) return 'unknown';
  return a === b ? 'same' : 'different';
}

/**
 * Produces a keyed HMAC fingerprint for cases where a value must be compared
 * across processes or persisted. A keyed HMAC (not a bare SHA-256) is required
 * so that low-entropy secrets cannot be recovered by brute-forcing the digest.
 *
 * The key must be kept secret and rotated; never publish fingerprints in
 * public CI artifacts.
 */
export function fingerprint(value: string, key: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two HMAC fingerprints. */
export function fingerprintsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * A wrapper around a secret string that refuses to reveal itself through
 * logging, JSON serialization, or string coercion. The raw value is only
 * reachable through {@link SecretValue.reveal}.
 */
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The number of characters in the underlying value. */
  get length(): number {
    return this.#value.length;
  }

  /** Explicit, auditable access to the raw value. */
  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return SECRET_MASK;
  }

  toJSON(): string {
    return SECRET_MASK;
  }

  /** Hides the value from `util.inspect` / `console.log`. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return SECRET_MASK;
  }
}
