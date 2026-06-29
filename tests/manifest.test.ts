import { writeManifest, checkManifest } from '../src/adapters/next/manifest';
import { defineConfig, variable } from '../src/contract/define';

const contract = defineConfig({
  contractVersion: 1,
  environments: ['staging', 'production'],
  variables: {
    NEXT_PUBLIC_API_URL: variable.url({ exposure: 'client', phase: 'build' }),
    DATABASE_URL: variable.url({ secret: true }),
  },
});

describe('writeManifest', () => {
  it('records only public variables, as fingerprints (never raw values)', () => {
    const m = writeManifest({
      contract,
      environment: 'staging',
      values: { NEXT_PUBLIC_API_URL: 'https://staging.example.com', DATABASE_URL: 'postgres://secret@h/db' },
      buildId: 'build-1',
    });
    expect(Object.keys(m.publicVariables)).toEqual(['NEXT_PUBLIC_API_URL']);
    expect(JSON.stringify(m)).not.toContain('staging.example.com');
    expect(JSON.stringify(m)).not.toContain('secret');
  });
});

describe('checkManifest — ENV009 build/runtime drift', () => {
  const built = writeManifest({
    contract,
    environment: 'staging',
    values: { NEXT_PUBLIC_API_URL: 'https://staging.example.com' },
    buildId: 'build-1',
  });

  it('flags a public value compiled for one env but deployed with another', () => {
    const findings = checkManifest({
      manifest: built,
      contract,
      environment: 'production',
      values: { NEXT_PUBLIC_API_URL: 'https://app.example.com' },
    });
    expect(findings.some((f) => f.code === 'ENV009' && f.variable === 'NEXT_PUBLIC_API_URL')).toBe(true);
    expect(findings[0].message.toLowerCase()).toContain('rebuild');
  });

  it('passes when the compiled value matches the target', () => {
    const findings = checkManifest({
      manifest: built,
      contract,
      environment: 'production',
      values: { NEXT_PUBLIC_API_URL: 'https://staging.example.com' },
    });
    expect(findings).toHaveLength(0);
  });

  it('flags a public var expected at runtime but missing from the build', () => {
    const findings = checkManifest({
      manifest: built,
      contract,
      environment: 'production',
      values: { NEXT_PUBLIC_API_URL: 'https://staging.example.com', NEXT_PUBLIC_NEW: 'x' },
    });
    expect(findings.some((f) => f.variable === 'NEXT_PUBLIC_NEW')).toBe(true);
  });
});
