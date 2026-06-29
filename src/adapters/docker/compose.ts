/**
 * Parses a Docker Compose file for environment configuration:
 * `services.<name>.environment` (map or list form),
 * `services.<name>.env_file` (string or list), and
 * `services.<name>.build.args` (map or list). Uses the in-house YAML subset
 * parser so the package keeps zero runtime dependencies.
 */

import type { AdapterVar } from '../types.js';
import { parseYaml, type YamlValue } from '../yaml/mini-yaml.js';

function isObject(v: YamlValue): v is { [key: string]: YamlValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const INTERP = /\$\{?\w/;

/** Reads an `environment`/`args` block, which may be a map or a `KEY=val` list. */
function readKeyValues(
  block: YamlValue,
  file: string,
  source: string,
  kind: AdapterVar['kind'],
): AdapterVar[] {
  const out: AdapterVar[] = [];
  const location = { file, line: 1 };

  if (isObject(block)) {
    for (const [key, val] of Object.entries(block)) {
      const value = val === null ? undefined : String(val);
      out.push({ key, value, location, source, kind, interpolated: !!value && INTERP.test(value) });
    }
  } else if (Array.isArray(block)) {
    for (const item of block) {
      if (typeof item !== 'string') continue;
      const eq = item.indexOf('=');
      if (eq === -1) {
        out.push({ key: item.trim(), location, source, kind });
      } else {
        const key = item.slice(0, eq).trim();
        const value = item.slice(eq + 1).trim();
        out.push({ key, value, location, source, kind, interpolated: INTERP.test(value) });
      }
    }
  }
  return out;
}

/** Parses a Compose file into discovered variables across all services. */
export function parseCompose(content: string, file: string): AdapterVar[] {
  const doc = parseYaml(content);
  if (!isObject(doc)) return [];

  const services = doc.services;
  if (!isObject(services)) return [];

  const vars: AdapterVar[] = [];
  const location = { file, line: 1 };

  for (const [name, svc] of Object.entries(services)) {
    if (!isObject(svc)) continue;

    if (svc.environment !== undefined) {
      vars.push(...readKeyValues(svc.environment, file, `compose environment (${name})`, 'env'));
    }

    if (svc.env_file !== undefined) {
      const files = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
      for (const f of files) {
        if (typeof f === 'string') {
          vars.push({ key: f, location, source: `compose env_file (${name})`, kind: 'env_file' });
        }
      }
    }

    if (isObject(svc.build) && svc.build.args !== undefined) {
      vars.push(...readKeyValues(svc.build.args, file, `compose build.args (${name})`, 'build-arg'));
    }
  }

  return vars;
}
