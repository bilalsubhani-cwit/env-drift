/**
 * The contract authoring API.
 *
 * `defineConfig` describes the full environment contract; the `variable`
 * builders declare individual variables with their type pre-filled. This is
 * the typed, reviewable replacement for treating `.env.example` as a schema.
 *
 * @example
 * ```ts
 * import { defineConfig, variable } from 'env-drift';
 *
 * export default defineConfig({
 *   contractVersion: 1,
 *   environments: ['local', 'ci', 'staging', 'production'],
 *   variables: {
 *     DATABASE_URL: variable.url({
 *       requiredIn: ['local', 'ci', 'staging', 'production'],
 *       secret: true,
 *       rules: { production: { requireHttps: false, forbiddenHosts: ['localhost'] } },
 *     }),
 *     DEBUG: variable.boolean({ default: false, rules: { production: { allowedValues: [false] } } }),
 *   },
 * });
 * ```
 */

import type { Contract, VariableDef, VariableType } from '../types.js';

/** Options accepted by every `variable.*` builder (the type is implied). */
export type VariableOptions = Omit<VariableDef, 'type'>;

/** Options for `variable.enum`, where `values` is required. */
export type EnumOptions = VariableOptions & { values: string[] };

/** Options for `variable.custom`, where a `validate` function is required. */
export type CustomOptions = VariableOptions & {
  validate: (value: string) => string | null;
};

function make(type: VariableType, opts: VariableOptions = {}): VariableDef {
  return { type, ...opts };
}

/**
 * Variable builders. Each fixes the `type` and forwards every other option,
 * so the contract reads declaratively and stays fully typed.
 */
export const variable = {
  string: (opts: VariableOptions = {}): VariableDef => make('string', opts),
  integer: (opts: VariableOptions = {}): VariableDef => make('integer', opts),
  number: (opts: VariableOptions = {}): VariableDef => make('number', opts),
  boolean: (opts: VariableOptions = {}): VariableDef => make('boolean', opts),
  url: (opts: VariableOptions = {}): VariableDef => make('url', opts),
  port: (opts: VariableOptions = {}): VariableDef => make('port', opts),
  email: (opts: VariableOptions = {}): VariableDef => make('email', opts),
  json: (opts: VariableOptions = {}): VariableDef => make('json', opts),
  list: (opts: VariableOptions = {}): VariableDef => make('list', opts),
  duration: (opts: VariableOptions = {}): VariableDef => make('duration', opts),

  /** An enumerated string. `values` lists the allowed members. */
  enum: (opts: EnumOptions): VariableDef => make('enum', opts),

  /**
   * A secret. Implies `secret: true` and `exposure: "server"` unless you
   * override them. Values are redacted everywhere by default.
   */
  secret: (opts: VariableOptions = {}): VariableDef =>
    make('secret', { secret: true, exposure: 'server', ...opts }),

  /** A custom-validated value. `validate` returns an error string or `null`. */
  custom: (opts: CustomOptions): VariableDef => make('custom', opts),
};

/**
 * Declares the environment contract. Returns the contract object unchanged
 * (typed and ready to be consumed by the scanner, checker, and runtime
 * loader). Kept side-effect-free so it is safe to `import` from app code.
 */
export function defineConfig(contract: Contract): Contract {
  return contract;
}
