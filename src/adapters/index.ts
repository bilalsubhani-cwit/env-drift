/**
 * Source adapters. Each understands how a particular system declares or injects
 * environment configuration, and contributes discovery and/or findings.
 */

export type { AdapterVar, AdapterVarKind } from './types.js';

// Docker / Compose
export { discoverDocker, checkDocker, isDockerfile, isComposeFile } from './docker/index.js';
export { parseDockerfile } from './docker/dockerfile.js';
export { parseCompose } from './docker/compose.js';

// Next.js / Vite build manifest (ENV009)
export { writeManifest, checkManifest } from './next/manifest.js';
export type { BuildManifest } from './next/manifest.js';

// YAML subset parser
export { parseYaml } from './yaml/mini-yaml.js';
export type { YamlValue } from './yaml/mini-yaml.js';
