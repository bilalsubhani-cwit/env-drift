import {
  SecretValue,
  maskValue,
  redactUrlCredentials,
  compareValues,
  fingerprint,
  fingerprintsMatch,
  SECRET_MASK,
} from '../src/engine/redact';

describe('redaction', () => {
  it('masks secret values', () => {
    expect(maskValue('super-secret', { secret: true })).toBe(SECRET_MASK);
  });

  it('redacts URL credentials for non-secret values', () => {
    expect(maskValue('postgres://user:pw@host/db', { secret: false })).toBe('postgres://***:***@host/db');
    expect(redactUrlCredentials('https://a:b@x.com')).toBe('https://***:***@x.com');
  });

  it('compares values without revealing them', () => {
    expect(compareValues('a', 'a')).toBe('same');
    expect(compareValues('a', 'b')).toBe('different');
    expect(compareValues(undefined, 'b')).toBe('unknown');
  });

  it('produces stable keyed HMAC fingerprints', () => {
    const a = fingerprint('value', 'key');
    const b = fingerprint('value', 'key');
    expect(a).toBe(b);
    expect(fingerprint('value', 'other')).not.toBe(a);
    expect(fingerprintsMatch(a, b)).toBe(true);
  });
});

describe('SecretValue', () => {
  it('never reveals itself through coercion, JSON, or logging', () => {
    const s = new SecretValue('hunter2');
    expect(String(s)).toBe(SECRET_MASK);
    expect(JSON.stringify({ s })).not.toContain('hunter2');
    expect(`${s}`).not.toContain('hunter2');
    expect(s.length).toBe(7);
  });

  it('reveals only through the explicit method', () => {
    expect(new SecretValue('x').reveal()).toBe('x');
  });
});
