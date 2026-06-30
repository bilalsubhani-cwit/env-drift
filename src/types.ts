/**
 * Core type definitions for envcanary: the environment contract, variable
 * declarations, scan results, and drift findings.
 *
 * These types are the public, stable surface of the package. Rule identifiers
 * (`ENV001`…`ENV016`) and the JSON shape of {@link Finding} are part of the
 * compatibility contract — see `codes.ts`.
 */

/** A named environment, e.g. `"local"`, `"staging"`, `"production"`. */
export type EnvironmentName = string;

/**
 * Where a variable is allowed to be read.
 *
 * - `server`   — server-side runtime only; must never reach the browser.
 * - `client`   — intentionally exposed to client/browser bundles.
 * - `build`    — consumed by the build system / tooling.
 * - `ci`       — used only inside CI/CD pipelines.
 * - `internal` — internal tooling/scripts.
 */
export type Exposure = 'server' | 'client' | 'build' | 'ci' | 'internal';

/** When in the application lifecycle a variable is consumed. */
export type Phase = 'build' | 'runtime' | 'test' | 'deploy';

/**
 * Severity of a policy violation. `off` disables a rule for a variable.
 * Ordered: `off` < `info` < `warning` < `error`.
 */
export type Severity = 'off' | 'info' | 'warning' | 'error';

/** The value-type a variable is validated against. */
export type VariableType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'url'
  | 'port'
  | 'email'
  | 'enum'
  | 'json'
  | 'list'
  | 'duration'
  | 'secret'
  | 'custom';

/** Effect a configuration change has on a running workload. */
export type DeploymentEffect =
  | 'none'
  | 'process-restart'
  | 'container-rollout'
  | 'rebuild-required';

/** How two environments' values for a variable are compared. */
export type DiffMode =
  | 'presence'
  | 'type'
  | 'semantic'
  | 'equality'
  | 'inequality'
  | 'none';

/** Environment-specific validation rules applied on top of the base type. */
export interface EnvRules {
  /** Require `https:` (URL types). */
  requireHttps?: boolean;
  /** Allowed URL protocols, e.g. `["postgres:", "postgresql:"]`. */
  allowedProtocols?: string[];
  /** Hostnames that must not appear (e.g. `localhost`, `127.0.0.1`). */
  forbiddenHosts?: string[];
  /** If set, the host must be one of these. */
  allowedHosts?: string[];
  /** Literal values that are never acceptable in this environment. */
  forbiddenValues?: string[];
  /** If set, the (coerced) value must be one of these. */
  allowedValues?: Array<string | number | boolean>;
  /** Numeric lower/upper bounds (number/port/integer types). */
  min?: number;
  max?: number;
  /** A regular expression (as a string) the raw value must match. */
  pattern?: string;
}

/** Declares which environments may, must, or must not share a value. */
export interface Differences {
  mode?: DiffMode;
  /** Pairs of environments whose effective values must differ. */
  mustDifferBetween?: Array<[EnvironmentName, EnvironmentName]>;
  /** Pairs of environments (or services) whose values must match. */
  mustMatchBetween?: Array<[EnvironmentName, EnvironmentName]>;
  /** Named value components to ignore during `semantic` comparison. */
  ignoreComponents?: string[];
}

/** Deprecation metadata for a variable scheduled for removal. */
export interface Deprecation {
  /** ISO-8601 date by which the variable must be removed. */
  removeAfter?: string;
  reason?: string;
  /** Name of the replacement variable, if any. */
  replacement?: string;
}

/** Secret-rotation policy. */
export interface Rotation {
  /** Maximum acceptable age of the secret, in days. */
  maximumAgeDays?: number;
}

/**
 * A single declared variable in the contract. All fields beyond `type` are
 * optional; the {@link variable} builders fill sensible defaults.
 */
export interface VariableDef {
  type: VariableType;

  /** Environments in which the variable must be present. */
  requiredIn?: EnvironmentName[];
  /** Environments in which the variable must NOT be present. */
  forbiddenIn?: EnvironmentName[];

  /** Marks the value as a secret: redacted everywhere, secret policies apply. */
  secret?: boolean;
  exposure?: Exposure;
  phase?: Phase;

  /** Default value used by the runtime loader when the variable is absent. */
  default?: string | number | boolean;

  description?: string;
  owner?: string;
  /** Overrides the default severity for every rule on this variable. */
  severity?: Severity;

  // ---- type-specific constraints -------------------------------------------
  /** Allowed members for `enum` types. */
  values?: string[];
  /** Minimum string/secret length. */
  minLength?: number;
  /** Maximum string/secret length. */
  maxLength?: number;
  /** Numeric bounds (number/integer/port). */
  min?: number;
  max?: number;
  /** Regular expression (string form) the raw value must match. */
  pattern?: string;
  /** Allowed URL protocols. */
  allowedProtocols?: string[];
  /** Values that always fail (e.g. known placeholders like `change-me`). */
  forbiddenValues?: string[];
  /** Delimiter for `list` types (default `,`). */
  separator?: string;
  /**
   * Custom validator. Returns an error message string when invalid, or `null`
   * when valid. Only meaningful for `type: "custom"`, but honoured for any type.
   */
  validate?: (value: string) => string | null;

  // ---- environment-aware policy --------------------------------------------
  rules?: Record<EnvironmentName, EnvRules>;
  differences?: Differences;
  deprecated?: Deprecation;
  deploymentEffect?: DeploymentEffect;
  rotation?: Rotation;

  // ---- monorepo / multi-service --------------------------------------------
  /** Services that read this variable. */
  consumers?: string[];
  /** Services that produce/own this variable. */
  producers?: string[];
}

/** A monorepo service root. */
export interface ServiceDef {
  root: string;
}

/** A controlled, time-boxed acceptance of a specific drift finding. */
export interface Suppression {
  rule: DriftCode;
  variable?: string;
  environment?: EnvironmentName;
  reason: string;
  owner: string;
  /** ISO-8601 date after which the suppression expires and CI fails. */
  expiresAt?: string;
  ticket?: string;
}

/** The committed, reviewable environment contract. */
export interface Contract {
  contractVersion: number;
  environments: EnvironmentName[];
  variables: Record<string, VariableDef>;
  services?: Record<string, ServiceDef>;
  suppressions?: Suppression[];
}

// ---------------------------------------------------------------------------
// Discovery & parsing
// ---------------------------------------------------------------------------

/** A location in a source or configuration file. */
export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

/** A single key=value entry parsed from a dotenv-style file. */
export interface EnvEntry {
  key: string;
  /** Raw value as written (after unquoting). Never logged for secrets. */
  value: string;
  location: SourceLocation;
  /** True when the same key was defined earlier in the same file. */
  duplicate?: boolean;
  /** True when an `export ` prefix was stripped. */
  exported?: boolean;
}

/** The result of parsing one dotenv-style file. */
export interface ParsedEnvFile {
  file: string;
  entries: EnvEntry[];
}

/** A static reference to an environment variable found in source code. */
export interface CodeReference {
  /** The variable name, or `null` when access is dynamic/computed. */
  key: string | null;
  location: SourceLocation;
  /** The access form, e.g. `process.env`, `import.meta.env`, `Deno.env.get`. */
  accessor: string;
  /** True when the key could not be statically determined. */
  dynamic: boolean;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/** Stable rule identifiers. See `codes.ts` for the registry. */
export type DriftCode =
  | 'ENV001'
  | 'ENV002'
  | 'ENV003'
  | 'ENV004'
  | 'ENV005'
  | 'ENV006'
  | 'ENV007'
  | 'ENV008'
  | 'ENV009'
  | 'ENV010'
  | 'ENV011'
  | 'ENV012'
  | 'ENV013'
  | 'ENV014'
  | 'ENV015'
  | 'ENV016';

/** Overall status of a check, surface, or run. */
export type Status = 'PASS' | 'FAIL' | 'WARNING' | 'UNKNOWN' | 'SKIPPED';

/** A single detected drift / policy violation. */
export interface Finding {
  code: DriftCode;
  severity: Severity;
  message: string;
  variable?: string;
  environment?: EnvironmentName;
  service?: string;
  location?: SourceLocation;
  /** Populated when a matching suppression silenced this finding. */
  suppressed?: boolean;
  suppressionReason?: string;
}

/** The aggregate result of a scan/check run. */
export interface DriftReport {
  status: Status;
  findings: Finding[];
  /** Findings that were silenced by an active suppression. */
  suppressed: Finding[];
  /** Counts by status, for summaries and exit codes. */
  summary: {
    error: number;
    warning: number;
    info: number;
    unknown: number;
  };
  /** Environment this report targeted, if any. */
  environment?: EnvironmentName;
}
