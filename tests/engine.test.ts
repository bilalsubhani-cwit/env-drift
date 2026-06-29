import { checkEnvironment, correlateCode } from '../src/engine/drift';
import { diffEnvironments } from '../src/engine/diff';
import { defineConfig, variable } from '../src/contract/define';
import type { CodeReference } from '../src/types';

const contract = defineConfig({
  contractVersion: 1,
  environments: ['local', 'production'],
  variables: {
    DATABASE_URL: variable.url({ requiredIn: ['production'], secret: true }),
    PORT: variable.port({ default: 3000 }),
    NEXT_PUBLIC_SECRET: variable.secret({}),
    OLD_KEY: variable.string({ deprecated: { removeAfter: '2020-01-01', replacement: 'NEW_KEY' } }),
  },
});

const NOW = new Date('2026-06-25T00:00:00Z');

describe('checkEnvironment', () => {
  it('reports ENV001 for a missing required variable', () => {
    const r = checkEnvironment({ contract, environment: 'production', values: {}, now: NOW });
    expect(r.findings.map((f) => f.code)).toContain('ENV001');
    expect(r.status).toBe('FAIL');
  });

  it('reports ENV002 for an undeclared key', () => {
    const r = checkEnvironment({ contract, environment: 'local', values: { MYSTERY: '1' }, now: NOW });
    expect(r.findings.some((f) => f.code === 'ENV002' && f.variable === 'MYSTERY')).toBe(true);
  });

  it('reports ENV007 for a secret on a public prefix', () => {
    const r = checkEnvironment({ contract, environment: 'local', values: {}, now: NOW });
    expect(r.findings.some((f) => f.code === 'ENV007' && f.variable === 'NEXT_PUBLIC_SECRET')).toBe(true);
  });

  it('escalates a deprecated variable past its removal date to error', () => {
    const r = checkEnvironment({ contract, environment: 'local', values: { OLD_KEY: 'x' }, now: NOW });
    const dep = r.findings.find((f) => f.code === 'ENV010');
    expect(dep?.severity).toBe('error');
  });

  it('detects ENV016 case-collisions', () => {
    const r = checkEnvironment({ contract, environment: 'local', values: { Path: 'a', PATH: 'b' }, now: NOW });
    expect(r.findings.some((f) => f.code === 'ENV016')).toBe(true);
  });

  it('never includes secret values in findings', () => {
    const r = checkEnvironment({
      contract,
      environment: 'production',
      values: { DATABASE_URL: 'postgres://user:hunter2@host/db' },
      now: NOW,
    });
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});

describe('suppressions', () => {
  it('silences a matching, unexpired suppression', () => {
    const c = defineConfig({
      ...contract,
      suppressions: [{ rule: 'ENV001', variable: 'DATABASE_URL', reason: 'wip', owner: 'me', expiresAt: '2099-01-01' }],
    });
    const r = checkEnvironment({ contract: c, environment: 'production', values: {}, now: NOW });
    expect(r.findings.some((f) => f.code === 'ENV001')).toBe(false);
    expect(r.suppressed.some((f) => f.code === 'ENV001')).toBe(true);
  });

  it('does not honour an expired suppression', () => {
    const c = defineConfig({
      ...contract,
      suppressions: [{ rule: 'ENV001', variable: 'DATABASE_URL', reason: 'wip', owner: 'me', expiresAt: '2020-01-01' }],
    });
    const r = checkEnvironment({ contract: c, environment: 'production', values: {}, now: NOW });
    expect(r.findings.some((f) => f.code === 'ENV001')).toBe(true);
  });

  it('refuses to suppress ENV007 (non-suppressible)', () => {
    const c = defineConfig({
      ...contract,
      suppressions: [{ rule: 'ENV007', reason: 'x', owner: 'me' }],
    });
    const r = checkEnvironment({ contract: c, environment: 'local', values: {}, now: NOW });
    expect(r.findings.some((f) => f.code === 'ENV007')).toBe(true);
  });
});

describe('correlateCode', () => {
  const ref = (key: string | null, dynamic = false): CodeReference => ({
    key,
    dynamic,
    accessor: 'process.env',
    location: { file: 'f.ts', line: 1 },
  });

  it('reports ENV002 for code references not in the contract', () => {
    const f = correlateCode(contract, [ref('NOT_DECLARED')]);
    expect(f.some((x) => x.code === 'ENV002' && x.variable === 'NOT_DECLARED')).toBe(true);
  });

  it('reports ENV003 for declared-but-unreferenced when access is static', () => {
    const f = correlateCode(contract, [ref('PORT')]);
    expect(f.some((x) => x.code === 'ENV003' && x.variable === 'DATABASE_URL')).toBe(true);
  });

  it('suppresses ENV003 when dynamic access is present', () => {
    const f = correlateCode(contract, [ref(null, true)]);
    expect(f.some((x) => x.code === 'ENV003')).toBe(false);
    expect(f.some((x) => x.code === 'ENV014')).toBe(true);
  });
});

describe('diffEnvironments', () => {
  const c = defineConfig({
    contractVersion: 1,
    environments: ['staging', 'production'],
    variables: {
      DB: variable.url({ secret: true, differences: { mustDifferBetween: [['staging', 'production']] } }),
      SHARED: variable.string({ differences: { mustMatchBetween: [['staging', 'production']] } }),
    },
  });

  it('flags ENV008 when values that must differ are identical', () => {
    const f = diffEnvironments(c, 'staging', { DB: 'same' }, 'production', { DB: 'same' });
    expect(f.some((x) => x.code === 'ENV008' && x.variable === 'DB')).toBe(true);
  });

  it('flags ENV011 when values that must match differ', () => {
    const f = diffEnvironments(c, 'staging', { SHARED: 'a' }, 'production', { SHARED: 'b' });
    expect(f.some((x) => x.code === 'ENV011' && x.variable === 'SHARED')).toBe(true);
  });
});
