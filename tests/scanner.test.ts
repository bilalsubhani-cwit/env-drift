import { scanSource } from '../src/scan/code-scanner';

const keys = (src: string) =>
  scanSource(src, 'f.ts')
    .filter((r) => !r.dynamic)
    .map((r) => r.key);

describe('scanSource', () => {
  it('finds dotted process.env access', () => {
    expect(keys('const x = process.env.DATABASE_URL;')).toEqual(['DATABASE_URL']);
  });

  it('finds bracket process.env access with a string key', () => {
    expect(keys('process.env["PORT"];')).toEqual(['PORT']);
  });

  it('finds import.meta.env and Bun.env', () => {
    expect(keys('import.meta.env.VITE_API_URL; Bun.env.TOKEN;')).toEqual(['VITE_API_URL', 'TOKEN']);
  });

  it('finds Deno.env.get', () => {
    expect(keys('Deno.env.get("SECRET");')).toEqual(['SECRET']);
  });

  it('finds destructured keys', () => {
    expect(keys('const { A, B } = process.env;')).toEqual(['A', 'B']);
  });

  it('marks computed access dynamic', () => {
    const refs = scanSource('process.env[prefix + key];', 'f.ts');
    expect(refs).toHaveLength(1);
    expect(refs[0].dynamic).toBe(true);
    expect(refs[0].key).toBeNull();
  });

  it('does not match inside strings or comments', () => {
    expect(keys('// process.env.NOPE\nconst s = "process.env.ALSO_NOPE";')).toEqual([]);
  });

  it('finds references inside wrapper calls', () => {
    expect(keys('createEnv({ DATABASE_URL: process.env.DATABASE_URL });')).toEqual(['DATABASE_URL']);
  });

  it('reports accurate locations', () => {
    const refs = scanSource('\n\nconst x = process.env.FOO;', 'f.ts');
    expect(refs[0].location.line).toBe(3);
  });

  it('handles optional chaining', () => {
    expect(keys('process.env?.FOO;')).toEqual(['FOO']);
    expect(keys('process.env?.["BAR"];')).toEqual(['BAR']);
  });
});
