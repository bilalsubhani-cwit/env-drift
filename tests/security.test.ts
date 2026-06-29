import { validateValue } from '../src/engine/rules';
import { checkEnvironment } from '../src/engine/drift';
import { parseYaml } from '../src/adapters/yaml/mini-yaml';
import { defineConfig, variable } from '../src/contract/define';

describe('secret values never leak into findings', () => {
  it('redacts a secret value in an invalid-type message', () => {
    const def = variable.secret({});
    const issues = validateValue({ ...def, type: 'url' }, 'NOT_A_URL_s3cr3tHost', 'production');
    const joined = JSON.stringify(issues);
    expect(joined).not.toContain('s3cr3tHost');
    expect(joined).toContain('<redacted>');
  });

  it('redacts a secret URL hostname in an env-safety message', () => {
    const def = variable.url({ secret: true, rules: { production: { forbiddenHosts: ['evil.internal'] } } });
    const issues = validateValue(def, 'https://evil.internal/db', 'production');
    expect(JSON.stringify(issues)).not.toContain('evil.internal');
  });

  it('redacts URL credentials for non-secret values in messages', () => {
    const def = variable.url({ allowedProtocols: ['postgres:'] });
    const issues = validateValue(def, 'https://user:pw@host', 'production');
    const joined = JSON.stringify(issues);
    // protocol mismatch fires; if the value were echoed, creds must be stripped
    expect(joined).not.toContain('user:pw');
  });

  it('does not echo a full secret in the whole report', () => {
    const contract = defineConfig({
      contractVersion: 1,
      environments: ['production'],
      variables: { TOKEN: variable.secret({ minLength: 64 }) },
    });
    const r = checkEnvironment({ contract, environment: 'production', values: { TOKEN: 'short-but-real-secret' } });
    expect(JSON.stringify(r)).not.toContain('short-but-real-secret');
  });
});

describe('DoS hardening', () => {
  it('caps regex input length instead of running an unbounded pattern', () => {
    const def = variable.string({ pattern: '^a+$' });
    const issues = validateValue(def, 'b'.repeat(10_000), 'production');
    expect(issues[0].message).toMatch(/too long/);
  });

  it('does not overflow the stack on deeply nested YAML', () => {
    let yaml = '';
    for (let i = 0; i < 500; i++) yaml += '  '.repeat(i) + `k${i}:\n`;
    expect(() => parseYaml(yaml)).not.toThrow();
  });
});

describe('no enumeration of live process-env names', () => {
  const contract = defineConfig({
    contractVersion: 1,
    environments: ['production'],
    variables: { PORT: variable.port({}) },
  });

  it('skips ENV002 for undeclared keys when reportUndeclared is false', () => {
    const values = { PORT: '3000', AWS_SECRET_ACCESS_KEY: 'x', HOME: '/root' };
    const off = checkEnvironment({ contract, environment: 'production', values, reportUndeclared: false });
    expect(off.findings.some((f) => f.code === 'ENV002')).toBe(false);

    const on = checkEnvironment({ contract, environment: 'production', values });
    expect(on.findings.some((f) => f.code === 'ENV002')).toBe(true);
  });
});
