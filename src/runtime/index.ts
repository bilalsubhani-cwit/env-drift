/**
 * Runtime entry point: `envcanary/runtime`.
 *
 * @example
 * ```ts
 * import { loadEnvironment } from 'envcanary/runtime';
 * import contract from '../envcanary.config';
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
