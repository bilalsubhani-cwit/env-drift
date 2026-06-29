import { parseDotenv, toEnvMap } from '../src/parse/dotenv';

describe('parseDotenv', () => {
  it('parses simple key=value pairs', () => {
    const { entries } = parseDotenv('A=1\nB=two', 'x.env');
    expect(entries.map((e) => [e.key, e.value])).toEqual([
      ['A', '1'],
      ['B', 'two'],
    ]);
  });

  it('ignores comments and blank lines', () => {
    const { entries } = parseDotenv('# c\n\nA=1\n   # c2\n', 'x.env');
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('A');
  });

  it('strips an export prefix', () => {
    const { entries } = parseDotenv('export A=1', 'x.env');
    expect(entries[0].key).toBe('A');
    expect(entries[0].exported).toBe(true);
  });

  it('handles double-quoted values with escapes', () => {
    const { entries } = parseDotenv('A="line1\\nline2"', 'x.env');
    expect(entries[0].value).toBe('line1\nline2');
  });

  it('keeps single-quoted values literal', () => {
    const { entries } = parseDotenv("A='no\\nescape'", 'x.env');
    expect(entries[0].value).toBe('no\\nescape');
  });

  it('supports multiline quoted values', () => {
    const { entries } = parseDotenv('A="one\ntwo\nthree"\nB=2', 'x.env');
    expect(entries[0].value).toBe('one\ntwo\nthree');
    expect(entries[1].key).toBe('B');
  });

  it('strips inline comments only when preceded by whitespace', () => {
    expect(parseDotenv('A=val # comment', 'x').entries[0].value).toBe('val');
    expect(parseDotenv('A=a#b', 'x').entries[0].value).toBe('a#b');
  });

  it('flags duplicate keys', () => {
    const { entries } = parseDotenv('A=1\nA=2', 'x.env');
    expect(entries[1].duplicate).toBe(true);
    expect(toEnvMap({ file: 'x', entries }).A).toBe('2'); // last wins
  });

  it('strips a leading BOM and tolerates CRLF', () => {
    const { entries } = parseDotenv('﻿A=1\r\nB=2\r\n', 'x.env');
    expect(entries.map((e) => e.key)).toEqual(['A', 'B']);
  });

  it('handles empty values', () => {
    expect(parseDotenv('A=', 'x').entries[0].value).toBe('');
  });

  it('rejects invalid keys', () => {
    expect(parseDotenv('1A=x\n-B=y', 'x').entries).toHaveLength(0);
  });
});
