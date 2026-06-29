import { parseYaml } from '../src/adapters/yaml/mini-yaml';

describe('parseYaml (subset)', () => {
  it('parses nested mappings', () => {
    const y = parseYaml('a:\n  b:\n    c: 1\n') as any;
    expect(y.a.b.c).toBe('1');
  });

  it('parses block sequences', () => {
    const y = parseYaml('list:\n  - one\n  - two\n') as any;
    expect(y.list).toEqual(['one', 'two']);
  });

  it('parses a compose-style environment map and list', () => {
    const mapForm = parseYaml('services:\n  web:\n    environment:\n      API: https://x\n      DEBUG: "false"\n') as any;
    expect(mapForm.services.web.environment.API).toBe('https://x');
    expect(mapForm.services.web.environment.DEBUG).toBe('false');

    const listForm = parseYaml('services:\n  web:\n    environment:\n      - API=https://x\n      - DEBUG\n') as any;
    expect(listForm.services.web.environment).toEqual(['API=https://x', 'DEBUG']);
  });

  it('ignores comments and document markers', () => {
    const y = parseYaml('---\n# a comment\nkey: value # trailing\n') as any;
    expect(y.key).toBe('value');
  });

  it('handles quoted scalars and inline arrays', () => {
    const y = parseYaml('a: "hello world"\nb: [x, y, z]\n') as any;
    expect(y.a).toBe('hello world');
    expect(y.b).toEqual(['x', 'y', 'z']);
  });
});
