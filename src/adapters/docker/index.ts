/**
 * Docker adapter: discovers environment variables declared in Dockerfiles and
 * Compose files, and reports Docker-specific drift — most importantly secrets
 * baked into build arguments or image `ENV`, which Docker records in image
 * history/metadata and which therefore must not carry secret material.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { Contract, Finding } from '../../types.js';
import type { AdapterVar } from '../types.js';
import { findFiles } from '../../scan/discover.js';
import { parseDockerfile } from './dockerfile.js';
import { parseCompose } from './compose.js';

/** Heuristic for a secret-looking variable name when the contract is silent. */
const SECRET_NAME = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY)/i;

/** True for a Dockerfile-like filename. */
export function isDockerfile(path: string): boolean {
  const b = basename(path);
  return b === 'Dockerfile' || b.startsWith('Dockerfile.') || /\.dockerfile$/i.test(b);
}

/** True for a Compose filename. */
export function isComposeFile(path: string): boolean {
  return /^(docker-compose|compose)(\.[\w-]+)?\.ya?ml$/i.test(basename(path));
}

/** Parses every Dockerfile and Compose file under `root`. */
export function discoverDocker(root: string): AdapterVar[] {
  const vars: AdapterVar[] = [];
  for (const path of findFiles(root, (p) => isDockerfile(p) || isComposeFile(p))) {
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    vars.push(...(isDockerfile(path) ? parseDockerfile(content, path) : parseCompose(content, path)));
  }
  return vars;
}

/** Classifies whether a key is a secret per the contract, else by heuristic. */
function secretness(key: string, contract: Contract): { secret: boolean; fromContract: boolean } {
  const def = contract.variables[key];
  if (def?.secret) return { secret: true, fromContract: true };
  if (SECRET_NAME.test(key)) return { secret: true, fromContract: false };
  return { secret: false, fromContract: false };
}

/**
 * Produces Docker-specific findings. A secret carried by a build arg or image
 * `ENV` is an exposure violation (`ENV007`): build args land in image history,
 * and `ENV` persists in the final image. Values are never shown.
 */
export function checkDocker(vars: AdapterVar[], contract: Contract): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const v of vars) {
    if (v.kind === 'env_file') continue; // a file reference, not a value
    const { secret, fromContract } = secretness(v.key, contract);
    if (!secret) continue;

    const dedupe = `${v.key}@${v.location.file}@${v.kind}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const where =
      v.kind === 'build-arg' || v.kind === 'arg'
        ? 'build arguments are recorded in image history'
        : 'image ENV persists in the final image layers';

    findings.push({
      code: 'ENV007',
      severity: fromContract ? 'error' : 'warning',
      message: `"${v.key}" is passed via ${v.source}; ${where}, so it must not carry a secret`,
      variable: v.key,
      location: v.location,
    });
  }

  return findings;
}
