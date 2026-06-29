import { validateValue, coerceBoolean } from '../src/engine/rules';
import { variable } from '../src/contract/define';

const codes = (def: ReturnType<typeof variable.url>, value: string, env = 'production') =>
  validateValue(def, value, env).map((i) => i.code);

describe('validateValue — types (ENV004)', () => {
  it('rejects out-of-range ports', () => {
    expect(codes(variable.port({}), '70000')).toContain('ENV004');
    expect(codes(variable.port({}), '8080')).toEqual([]);
  });

  it('validates urls and protocols', () => {
    expect(codes(variable.url({ allowedProtocols: ['postgres:'] }), 'not-a-url')).toContain('ENV004');
    expect(codes(variable.url({ allowedProtocols: ['postgres:'] }), 'https://x')).toContain('ENV004');
    expect(codes(variable.url({ allowedProtocols: ['postgres:'] }), 'postgres://h/db')).toEqual([]);
  });

  it('validates enums, integers, booleans, json, duration', () => {
    expect(codes(variable.enum({ values: ['a', 'b'] }), 'c')).toContain('ENV004');
    expect(codes(variable.integer({ min: 1 }), '0')).toContain('ENV004');
    expect(codes(variable.boolean({}), 'maybe')).toContain('ENV004');
    expect(codes(variable.json({}), '{bad')).toContain('ENV004');
    expect(codes(variable.duration({}), '5x')).toContain('ENV004');
    expect(codes(variable.duration({}), '5m')).toEqual([]);
  });

  it('enforces minLength and forbidden values', () => {
    expect(codes(variable.secret({ minLength: 10 }), 'short')).toContain('ENV004');
    expect(codes(variable.secret({ forbiddenValues: ['change-me'] }), 'change-me')).toContain('ENV004');
  });

  it('never echoes a secret forbidden value in the message', () => {
    const issues = validateValue(variable.secret({ forbiddenValues: ['s3cr3t'] }), 's3cr3t', 'production');
    expect(issues[0].message).not.toContain('s3cr3t');
  });
});

describe('validateValue — environment safety (ENV008)', () => {
  it('flags forbidden hosts and requireHttps', () => {
    const db = variable.url({ rules: { production: { forbiddenHosts: ['localhost'] } } });
    expect(codes(db, 'postgres://localhost/db')).toContain('ENV008');

    const api = variable.url({ rules: { production: { requireHttps: true } } });
    expect(codes(api, 'http://example.com')).toContain('ENV008');
    expect(codes(api, 'https://example.com')).toEqual([]);
  });

  it('enforces allowedValues per environment', () => {
    const debug = variable.boolean({ rules: { production: { allowedValues: [false] } } });
    expect(codes(debug, 'true')).toContain('ENV008');
    expect(codes(debug, 'false')).toEqual([]);
  });

  it('only applies env rules in the matching environment', () => {
    const api = variable.url({ rules: { production: { requireHttps: true } } });
    expect(validateValue(api, 'http://x.com', 'local')).toEqual([]);
  });
});

describe('coerceBoolean', () => {
  it('coerces common spellings', () => {
    expect(coerceBoolean('YES')).toBe(true);
    expect(coerceBoolean('off')).toBe(false);
    expect(coerceBoolean('nonsense')).toBeNull();
  });
});
