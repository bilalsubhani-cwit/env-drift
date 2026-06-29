import { checkServices, type ServiceScan } from '../src/engine/services';
import { defineConfig, variable } from '../src/contract/define';
import type { CodeReference } from '../src/types';

const ref = (key: string | null, dynamic = false): CodeReference => ({
  key,
  dynamic,
  accessor: 'process.env',
  location: { file: 'f.ts', line: 1 },
});

const contract = defineConfig({
  contractVersion: 1,
  environments: ['production'],
  services: { web: { root: 'apps/web' }, api: { root: 'apps/api' }, worker: { root: 'apps/worker' } },
  variables: {
    DATABASE_URL: variable.url({ consumers: ['api', 'worker'] }),
    JWT_SECRET: variable.secret({ consumers: ['api', 'worker'] }),
    NEXT_PUBLIC_API_URL: variable.url({ consumers: ['web'] }),
  },
});

describe('checkServices', () => {
  it('flags ENV011 when a declared consumer never references the variable', () => {
    const scans: ServiceScan[] = [
      { service: 'api', references: [ref('DATABASE_URL')] },
      { service: 'worker', references: [] }, // declared consumer, but unused
    ];
    const f = checkServices(contract, scans);
    expect(f.some((x) => x.code === 'ENV011' && x.variable === 'DATABASE_URL' && x.service === 'worker')).toBe(true);
  });

  it('flags ENV013 when a service is granted a secret it does not use', () => {
    const scans: ServiceScan[] = [
      { service: 'api', references: [ref('JWT_SECRET')] },
      { service: 'worker', references: [] }, // granted JWT_SECRET, never uses it
    ];
    const f = checkServices(contract, scans);
    const finding = f.find((x) => x.variable === 'JWT_SECRET' && x.service === 'worker');
    expect(finding?.code).toBe('ENV013');
  });

  it('flags ENV011 when a non-consumer service references the variable', () => {
    const scans: ServiceScan[] = [
      { service: 'web', references: [ref('DATABASE_URL')] }, // web is not a consumer of DATABASE_URL
    ];
    const f = checkServices(contract, scans);
    expect(f.some((x) => x.code === 'ENV011' && x.variable === 'DATABASE_URL' && x.service === 'web')).toBe(true);
  });

  it('does not accuse a service with dynamic access of not using a variable', () => {
    const scans: ServiceScan[] = [
      { service: 'api', references: [ref('DATABASE_URL')] },
      { service: 'worker', references: [ref(null, true)] }, // dynamic — unprovable
    ];
    const f = checkServices(contract, scans);
    expect(f.some((x) => x.service === 'worker' && x.variable === 'DATABASE_URL')).toBe(false);
  });

  it('passes when every consumer references the variable and no one else does', () => {
    const scans: ServiceScan[] = [
      { service: 'api', references: [ref('DATABASE_URL'), ref('JWT_SECRET')] },
      { service: 'worker', references: [ref('DATABASE_URL'), ref('JWT_SECRET')] },
      { service: 'web', references: [ref('NEXT_PUBLIC_API_URL')] },
    ];
    expect(checkServices(contract, scans)).toHaveLength(0);
  });

  it('ignores variables without a consumers list', () => {
    const c = defineConfig({
      contractVersion: 1,
      environments: ['production'],
      services: { api: { root: 'apps/api' } },
      variables: { PORT: variable.port({}) },
    });
    expect(checkServices(c, [{ service: 'api', references: [] }])).toHaveLength(0);
  });
});
