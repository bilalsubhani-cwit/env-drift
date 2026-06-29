/**
 * Structural validation of a contract object. This checks that the contract
 * itself is well-formed (the kind of error the CLI reports as exit code 2),
 * as opposed to checking an environment against the contract.
 */

import type { Contract, VariableType, EnvironmentName } from '../types.js';

const KNOWN_TYPES: ReadonlySet<VariableType> = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'url',
  'port',
  'email',
  'enum',
  'json',
  'list',
  'duration',
  'secret',
  'custom',
]);

/** A structural problem with the contract document. */
export interface ContractError {
  path: string;
  message: string;
}

/**
 * Validates the shape of a contract. Returns a list of structural errors; an
 * empty list means the contract is well-formed. Does not look at any
 * environment values.
 */
export function validateContract(contract: Contract): ContractError[] {
  const errors: ContractError[] = [];

  if (typeof contract.contractVersion !== 'number') {
    errors.push({
      path: 'contractVersion',
      message: 'contractVersion must be a number',
    });
  }

  if (!Array.isArray(contract.environments) || contract.environments.length === 0) {
    errors.push({
      path: 'environments',
      message: 'environments must be a non-empty array',
    });
  }

  const envSet = new Set<EnvironmentName>(contract.environments ?? []);

  if (!contract.variables || typeof contract.variables !== 'object') {
    errors.push({ path: 'variables', message: 'variables must be an object' });
    return errors;
  }

  for (const [name, def] of Object.entries(contract.variables)) {
    const base = `variables.${name}`;

    if (!def || typeof def !== 'object') {
      errors.push({ path: base, message: 'variable must be an object' });
      continue;
    }

    if (!KNOWN_TYPES.has(def.type)) {
      errors.push({ path: `${base}.type`, message: `unknown type "${String(def.type)}"` });
    }

    if (def.type === 'enum' && (!def.values || def.values.length === 0)) {
      errors.push({ path: `${base}.values`, message: 'enum variable requires non-empty values' });
    }

    if (def.type === 'custom' && typeof def.validate !== 'function') {
      errors.push({ path: `${base}.validate`, message: 'custom variable requires a validate function' });
    }

    // Every referenced environment must be declared in `environments`.
    for (const field of ['requiredIn', 'forbiddenIn'] as const) {
      for (const env of def[field] ?? []) {
        if (!envSet.has(env)) {
          errors.push({ path: `${base}.${field}`, message: `unknown environment "${env}"` });
        }
      }
    }
    for (const env of Object.keys(def.rules ?? {})) {
      if (!envSet.has(env)) {
        errors.push({ path: `${base}.rules`, message: `unknown environment "${env}"` });
      }
    }

    // A variable cannot be both required and forbidden in the same environment.
    const required = new Set(def.requiredIn ?? []);
    for (const env of def.forbiddenIn ?? []) {
      if (required.has(env)) {
        errors.push({
          path: `${base}`,
          message: `"${env}" appears in both requiredIn and forbiddenIn`,
        });
      }
    }

    // A client-exposed secret is a contradiction the contract should not allow.
    if (def.secret && def.exposure === 'client') {
      errors.push({
        path: `${base}`,
        message: 'a secret cannot have exposure "client"',
      });
    }
  }

  return errors;
}
