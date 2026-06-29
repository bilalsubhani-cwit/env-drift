/**
 * env-drift — a configuration contract, provenance and drift-detection engine.
 *
 * Know what configuration your application expects, where it comes from, what
 * actually reached the workload, and whether the difference is safe.
 *
 * Zero runtime dependencies. Secret-safe by default.
 *
 * @example
 * ```ts
 * import { defineConfig, variable, checkEnvironment } from 'env-drift';
 *
 * const contract = defineConfig({
 *   contractVersion: 1,
 *   environments: ['local', 'production'],
 *   variables: {
 *     DATABASE_URL: variable.url({ requiredIn: ['production'], secret: true }),
 *   },
 * });
 *
 * const report = checkEnvironment({ contract, environment: 'production', values: process.env });
 * console.log(report.status); // 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN'
 * ```
 */

// Contract authoring
export { defineConfig, variable } from './contract/define.js';
export type { VariableOptions, EnumOptions, CustomOptions } from './contract/define.js';
export { validateContract } from './contract/validate.js';
export type { ContractError } from './contract/validate.js';

// Drift engine
export { checkEnvironment, correlateCode } from './engine/drift.js';
export type { CheckInput } from './engine/drift.js';
export { diffEnvironments } from './engine/diff.js';
export { validateValue, coerceBoolean } from './engine/rules.js';
export type { RuleIssue } from './engine/rules.js';

// Parsing & discovery
export { parseDotenv, toEnvMap } from './parse/dotenv.js';
export { scanSource } from './scan/code-scanner.js';
export { scanProjectCode, discoverEnvFiles, readEnvFile, isEnvFile } from './scan/discover.js';
export { resolvePrecedence, precedenceRank, isLocalSource } from './scan/precedence.js';
export type { PrecedenceResult, KeyProvenance, KeyDefinition } from './scan/precedence.js';

// Redaction / secret safety
export {
  SecretValue,
  maskValue,
  redactUrlCredentials,
  compareValues,
  fingerprint,
  fingerprintsMatch,
  SECRET_MASK,
} from './engine/redact.js';
export type { ValueComparison } from './engine/redact.js';

// Reporting
export { render, renderTerminal, renderJson, renderSarif, reportExitCode } from './report/index.js';
export type { ReportFormat } from './report/index.js';

// Generators
export { generateExample, generateTypes, generateDocs } from './generate/index.js';

// Adapters (Docker / Compose / Next.js build manifest)
export {
  discoverDocker,
  checkDocker,
  isDockerfile,
  isComposeFile,
  parseDockerfile,
  parseCompose,
  writeManifest,
  checkManifest,
  parseYaml,
} from './adapters/index.js';
export type { AdapterVar, AdapterVarKind, BuildManifest, YamlValue } from './adapters/index.js';

// Drift taxonomy
export { CODES, codeInfo, maxSeverity, compareSeverity } from './codes.js';
export type { CodeInfo } from './codes.js';

// Types
export type {
  Contract,
  VariableDef,
  ServiceDef,
  Suppression,
  EnvironmentName,
  Exposure,
  Phase,
  Severity,
  VariableType,
  DeploymentEffect,
  DiffMode,
  EnvRules,
  Differences,
  Deprecation,
  Rotation,
  EnvEntry,
  ParsedEnvFile,
  CodeReference,
  SourceLocation,
  DriftCode,
  Status,
  Finding,
  DriftReport,
} from './types.js';
