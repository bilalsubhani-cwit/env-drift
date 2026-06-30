/**
 * Adversarial hardening for the two security-critical paths a reviewer flagged:
 * secret redaction (a leak here is the worst-case bug) and `.env` precedence /
 * shadowing (the basis of ENV006). These tests try to *make* the engine leak a
 * secret or mis-rank a source, rather than confirming the happy path.
 */

import { checkEnvironment } from '../src/engine/drift';
import { diffEnvironments } from '../src/engine/diff';
import { validateValue } from '../src/engine/rules';
import { render } from '../src/report/index';
import { SecretValue, redactUrlCredentials, maskValue, compareValues } from '../src/engine/redact';
import { resolvePrecedence, precedenceRank } from '../src/scan/precedence';
import { parseDotenv } from '../src/parse/dotenv';
import { defineConfig, variable } from '../src/contract/define';

// A distinctive token that must never appear in any rendered output.
const SECRET = 'zZ9-LEAK-CANARY-7f3a8b2c1d4e';

describe('redaction is leak-proof across every output surface', () => {
  const contract = defineConfig({
    contractVersion: 1,
    environments: ['production'],
    variables: {
      // Each variable is crafted so its value FAILS validation, exercising the
      // message paths that historically echoed the raw value.
      DB_URL: variable.url({ requiredIn: ['production'], secret: true, rules: { production: { forbiddenHosts: ['evil.host'] } } }),
      API_PORT: variable.port({ secret: true }),
      MODE: variable.enum({ values: ['a', 'b'], secret: true }),
      TOKEN: variable.secret({ minLength: 200, forbiddenValues: [SECRET] }),
      BLOB: variable.json({ secret: true }),
      TTL: variable.duration({ secret: true }),
    },
  });

  const values: Record<string, string> = {
    DB_URL: `https://evil.host/${SECRET}`,
    API_PORT: `99999${SECRET}`,
    MODE: SECRET,
    TOKEN: SECRET,
    BLOB: `{bad-json ${SECRET}`,
    TTL: `5x ${SECRET}`,
  };

  const report = checkEnvironment({ contract, environment: 'production', values });

  it('produces findings (the failure paths are actually hit)', () => {
    expect(report.findings.length).toBeGreaterThanOrEqual(5);
  });

  for (const format of ['terminal', 'json', 'sarif'] as const) {
    it(`never leaks a secret in ${format} output`, () => {
      const rendered = render(report, format);
      expect(rendered).not.toContain(SECRET);
      expect(rendered).not.toContain('evil.host'); // secret URL host is redacted too
    });
  }

  it('never leaks a secret in the raw report object', () => {
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it('redacts secret values in single-value validation messages', () => {
    for (const [name, def] of Object.entries(contract.variables)) {
      const issues = validateValue(def, values[name], 'production');
      expect(JSON.stringify(issues)).not.toContain(SECRET);
    }
  });

  it('does not leak secret values via mustDiffer diff messages', () => {
    const c = defineConfig({
      contractVersion: 1,
      environments: ['staging', 'production'],
      variables: { K: variable.secret({ differences: { mustDifferBetween: [['staging', 'production']] } }) },
    });
    const f = diffEnvironments(c, 'staging', { K: SECRET }, 'production', { K: SECRET });
    expect(JSON.stringify(f)).not.toContain(SECRET);
  });
});

describe('SecretValue cannot be coerced into revealing itself', () => {
  const s = new SecretValue(SECRET);

  it('resists template, concat, join, JSON, and spread', () => {
    expect(`${s}`).not.toContain(SECRET);
    expect('x' + s).not.toContain(SECRET);
    expect([s, s].join(',')).not.toContain(SECRET);
    expect(JSON.stringify({ s })).not.toContain(SECRET);
    expect(JSON.stringify({ ...{ s } })).not.toContain(SECRET);
    expect(String(s)).not.toContain(SECRET);
  });

  it('reveals only through the explicit method', () => {
    expect(s.reveal()).toBe(SECRET);
    expect(s.length).toBe(SECRET.length);
  });
});

describe('redactUrlCredentials handles hostile shapes', () => {
  it('redacts credentials, including multiple and odd characters', () => {
    expect(redactUrlCredentials('postgres://u:p@h/db')).toBe('postgres://***:***@h/db');
    expect(redactUrlCredentials('redis://user:p@ss-word!@host:6379')).not.toContain('p@ss-word');
    const two = redactUrlCredentials('a://u1:p1@h1 b://u2:p2@h2');
    expect(two).not.toContain('p1');
    expect(two).not.toContain('p2');
  });

  it('leaves credential-free strings unchanged and never throws', () => {
    expect(redactUrlCredentials('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(() => redactUrlCredentials('not a url at all ::: @@@')).not.toThrow();
  });

  it('maskValue never returns a secret and truncation keeps no tail of it', () => {
    expect(maskValue(SECRET, { secret: true })).not.toContain('LEAK');
    const long = 'A'.repeat(500) + SECRET;
    const masked = maskValue(long, { secret: false });
    expect(masked).not.toContain(SECRET); // canary is past the truncation point
  });

  it('compareValues never returns the values themselves', () => {
    expect(compareValues(SECRET, SECRET)).toBe('same');
    expect(compareValues(SECRET, 'other')).toBe('different');
  });
});

describe('precedence ranking is total and correctly ordered', () => {
  const f = (name: string, body: string) => parseDotenv(body, name);

  it('orders all four layers strictly for the target environment', () => {
    const r4 = precedenceRank('.env.production.local', 'production');
    const r3 = precedenceRank('.env.local', 'production');
    const r2 = precedenceRank('.env.production', 'production');
    const r1 = precedenceRank('.env', 'production');
    const r0 = precedenceRank('.env.staging', 'production'); // other env
    expect(r4).toBeGreaterThan(r3);
    expect(r3).toBeGreaterThan(r2);
    expect(r2).toBeGreaterThan(r1);
    expect(r1).toBeGreaterThan(r0);
  });

  it('elects the highest-ranked layer when all are present', () => {
    const { values } = resolvePrecedence(
      [
        f('.env', 'K=base'),
        f('.env.production', 'K=prod'),
        f('.env.local', 'K=local'),
        f('.env.production.local', 'K=prodlocal'),
      ],
      'production',
    );
    expect(values.K).toBe('prodlocal');
  });

  it('breaks ties by later-discovered file', () => {
    // Two files of equal rank (both "other env" rank 1): last wins.
    const { values } = resolvePrecedence(
      [f('.env.staging', 'K=first'), f('.env.test', 'K=second')],
      'production',
    );
    expect(values.K).toBe('second');
  });
});

describe('ENV006 fires only on genuine local-over-committed shadowing', () => {
  const f = (name: string, body: string) => parseDotenv(body, name);
  const contract = defineConfig({
    contractVersion: 1,
    environments: ['production'],
    variables: { K: variable.string({}), S: variable.secret({}) },
  });
  const env006 = (files: ReturnType<typeof f>[]) =>
    checkEnvironment({
      contract,
      environment: 'production',
      values: resolvePrecedence(files, 'production').values,
      files,
    }).findings.filter((x) => x.code === 'ENV006');

  it('flags a local file shadowing a committed value with a DIFFERENT value', () => {
    expect(env006([f('.env.production', 'K=prod'), f('.env.local', 'K=dev')])).toHaveLength(1);
  });

  it('does NOT flag when the local value equals the committed value', () => {
    expect(env006([f('.env.production', 'K=same'), f('.env.local', 'K=same')])).toHaveLength(0);
  });

  it('does NOT flag intentional committed layering (.env.production over .env)', () => {
    expect(env006([f('.env', 'K=base'), f('.env.production', 'K=prod')])).toHaveLength(0);
  });

  it('does NOT flag when only a local file defines the key', () => {
    expect(env006([f('.env.local', 'K=only')])).toHaveLength(0);
  });

  it('never includes the shadowed secret value in the ENV006 message', () => {
    const findings = env006([f('.env.production', `S=committed-${SECRET}`), f('.env.local', `S=local-${SECRET}`)]);
    expect(findings).toHaveLength(1);
    expect(JSON.stringify(findings)).not.toContain(SECRET);
  });
});
