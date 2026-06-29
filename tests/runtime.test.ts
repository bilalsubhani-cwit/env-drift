import { loadEnvironment, EnvironmentValidationError } from '../src/runtime/load';
import { SecretValue } from '../src/engine/redact';
import { defineConfig, variable } from '../src/contract/define';

const contract = defineConfig({
  contractVersion: 1,
  environments: ['local', 'production'],
  variables: {
    PORT: variable.port({ default: 3000, requiredIn: ['production'] }),
    DEBUG: variable.boolean({ default: false }),
    TAGS: variable.list({}),
    DATABASE_URL: variable.url({ secret: true, requiredIn: ['production'] }),
  },
});

describe('loadEnvironment', () => {
  it('coerces values to their declared types', () => {
    const env = loadEnvironment({
      contract,
      environment: 'local',
      source: { PORT: '8080', DEBUG: 'true', TAGS: 'a, b ,c', DATABASE_URL: 'postgres://h/db' },
    });
    expect(env.PORT).toBe(8080);
    expect(env.DEBUG).toBe(true);
    expect(env.TAGS).toEqual(['a', 'b', 'c']);
    expect(env.DATABASE_URL).toBeInstanceOf(SecretValue);
  });

  it('applies defaults when a value is absent', () => {
    const env = loadEnvironment({ contract, environment: 'local', source: {} });
    expect(env.PORT).toBe(3000);
    expect(env.DEBUG).toBe(false);
  });

  it('throws in production when a required value is missing', () => {
    expect(() =>
      loadEnvironment({ contract, environment: 'production', source: { PORT: '80' } }),
    ).toThrow(EnvironmentValidationError);
  });

  it('warns instead of throwing in local', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    loadEnvironment({ contract, environment: 'local', source: { PORT: 'not-a-port' } });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns a frozen object restricted to declared variables', () => {
    const env = loadEnvironment({ contract, environment: 'local', source: { PORT: '80', STRAY: 'x' } });
    expect(Object.isFrozen(env)).toBe(true);
    expect('STRAY' in env).toBe(false);
  });
});
