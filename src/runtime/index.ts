/**
 * Runtime entry point: `env-drift/runtime`.
 *
 * @example
 * ```ts
 * import { loadEnvironment } from 'env-drift/runtime';
 * import contract from '../env-drift.config';
 *
 * export const env = loadEnvironment({
 *   contract,
 *   environment: process.env.APP_ENV ?? 'local',
 * });
 * ```
 */

export { loadEnvironment, EnvironmentValidationError } from './load.js';
export type { LoadOptions, LoadedValue, FailureAction } from './load.js';
export { SecretValue } from '../engine/redact.js';
