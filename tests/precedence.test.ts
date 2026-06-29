import { resolvePrecedence, precedenceRank, isLocalSource } from '../src/scan/precedence';
import { parseDotenv } from '../src/parse/dotenv';
import { checkEnvironment } from '../src/engine/drift';
import { defineConfig, variable } from '../src/contract/define';

const file = (name: string, body: string) => parseDotenv(body, name);

describe('precedenceRank', () => {
  it('ranks local overrides above committed files', () => {
    expect(precedenceRank('.env.production.local', 'production')).toBeGreaterThan(
      precedenceRank('.env.local', 'production'),
    );
    expect(precedenceRank('.env.local', 'production')).toBeGreaterThan(
      precedenceRank('.env.production', 'production'),
    );
    expect(precedenceRank('.env.production', 'production')).toBeGreaterThan(
      precedenceRank('.env', 'production'),
    );
    expect(precedenceRank('.env.development', 'production')).toBe(1);
  });

  it('identifies local sources', () => {
    expect(isLocalSource('.env.local')).toBe(true);
    expect(isLocalSource('.env.production.local')).toBe(true);
    expect(isLocalSource('.env.production')).toBe(false);
  });
});

describe('resolvePrecedence', () => {
  it('picks the highest-precedence value', () => {
    const { values } = resolvePrecedence(
      [file('.env', 'API=base'), file('.env.production', 'API=prod'), file('.env.local', 'API=local')],
      'production',
    );
    expect(values.API).toBe('local'); // .env.local outranks committed files
  });

  it('records provenance only for multiply-defined keys', () => {
    const { provenance } = resolvePrecedence(
      [file('.env', 'A=1\nB=2'), file('.env.production', 'A=9')],
      'production',
    );
    const keys = provenance.map((p) => p.key);
    expect(keys).toContain('A');
    expect(keys).not.toContain('B');
  });
});

describe('ENV005 / ENV006 via checkEnvironment', () => {
  const contract = defineConfig({
    contractVersion: 1,
    environments: ['local', 'production'],
    variables: { API: variable.string({}), DB: variable.string({}) },
  });

  it('reports ENV005 for a duplicate key in one file', () => {
    const f = file('.env.production', 'API=1\nAPI=2');
    const r = checkEnvironment({
      contract,
      environment: 'production',
      values: { API: '2' },
      files: [f],
    });
    expect(r.findings.some((x) => x.code === 'ENV005' && x.variable === 'API')).toBe(true);
  });

  it('reports ENV006 when a local file shadows a committed value', () => {
    const files = [file('.env.production', 'DB=postgres://prod'), file('.env.local', 'DB=postgres://localdev')];
    const r = checkEnvironment({
      contract,
      environment: 'production',
      values: { DB: 'postgres://localdev' },
      files,
    });
    expect(r.findings.some((x) => x.code === 'ENV006' && x.variable === 'DB')).toBe(true);
  });

  it('does NOT report ENV006 for intentional committed layering', () => {
    const files = [file('.env', 'DB=base'), file('.env.production', 'DB=prod')];
    const r = checkEnvironment({ contract, environment: 'production', values: { DB: 'prod' }, files });
    expect(r.findings.some((x) => x.code === 'ENV006')).toBe(false);
  });

  it('does NOT report ENV006 when the local value matches the committed one', () => {
    const files = [file('.env.production', 'DB=same'), file('.env.local', 'DB=same')];
    const r = checkEnvironment({ contract, environment: 'production', values: { DB: 'same' }, files });
    expect(r.findings.some((x) => x.code === 'ENV006')).toBe(false);
  });
});
