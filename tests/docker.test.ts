import { parseDockerfile } from '../src/adapters/docker/dockerfile';
import { parseCompose } from '../src/adapters/docker/compose';
import { checkDocker } from '../src/adapters/docker/index';
import { defineConfig, variable } from '../src/contract/define';

describe('parseDockerfile', () => {
  it('parses ENV key=value pairs and legacy form', () => {
    const vars = parseDockerfile('ENV A=1 B="two words"\nENV C three\n', 'Dockerfile');
    const map = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    expect(map).toEqual({ A: '1', B: 'two words', C: 'three' });
    expect(vars.every((v) => v.kind === 'env')).toBe(true);
  });

  it('parses ARG with and without defaults', () => {
    const vars = parseDockerfile('ARG TOKEN\nARG REGION=us-east-1\n', 'Dockerfile');
    expect(vars.map((v) => [v.key, v.value ?? null])).toEqual([
      ['TOKEN', null],
      ['REGION', 'us-east-1'],
    ]);
  });

  it('handles line continuations', () => {
    const vars = parseDockerfile('ENV A=1 \\\n    B=2\n', 'Dockerfile');
    expect(vars.map((v) => v.key)).toEqual(['A', 'B']);
  });
});

describe('parseCompose', () => {
  it('reads environment (map + list), env_file, and build.args', () => {
    const yaml = [
      'services:',
      '  web:',
      '    environment:',
      '      API_URL: https://api',
      '    env_file:',
      '      - .env.production',
      '    build:',
      '      args:',
      '        - BUILD_TOKEN=abc',
      '  worker:',
      '    environment:',
      '      - QUEUE=jobs',
      '',
    ].join('\n');
    const vars = parseCompose(yaml, 'compose.yml');
    const byKey = (k: string) => vars.find((v) => v.key === k);
    expect(byKey('API_URL')?.value).toBe('https://api');
    expect(byKey('.env.production')?.kind).toBe('env_file');
    expect(byKey('BUILD_TOKEN')?.kind).toBe('build-arg');
    expect(byKey('QUEUE')?.value).toBe('jobs');
  });
});

describe('checkDocker — build-secret exposure (ENV007)', () => {
  const contract = defineConfig({
    contractVersion: 1,
    environments: ['production'],
    variables: { DATABASE_PASSWORD: variable.secret({}) },
  });

  it('flags a contract secret carried by a build arg as an error', () => {
    const vars = parseCompose(
      'services:\n  web:\n    build:\n      args:\n        - DATABASE_PASSWORD=hunter2\n',
      'compose.yml',
    );
    const findings = checkDocker(vars, contract);
    const f = findings.find((x) => x.variable === 'DATABASE_PASSWORD');
    expect(f?.code).toBe('ENV007');
    expect(f?.severity).toBe('error');
  });

  it('flags a secret-looking key by heuristic as a warning, never showing the value', () => {
    const vars = parseDockerfile('ARG API_TOKEN=supersecret\n', 'Dockerfile');
    const findings = checkDocker(vars, contract);
    const f = findings.find((x) => x.variable === 'API_TOKEN');
    expect(f?.code).toBe('ENV007');
    expect(f?.severity).toBe('warning');
    expect(JSON.stringify(findings)).not.toContain('supersecret');
  });

  it('does not flag non-secret build values', () => {
    const vars = parseDockerfile('ENV NODE_ENV=production\n', 'Dockerfile');
    expect(checkDocker(vars, contract)).toHaveLength(0);
  });
});
