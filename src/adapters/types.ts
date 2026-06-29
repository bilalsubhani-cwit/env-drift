/**
 * Shared types for source adapters (Docker, Compose, Next.js, …). An adapter
 * discovers how a particular system declares or injects environment variables
 * and normalizes them into {@link AdapterVar}s plus any adapter-specific
 * {@link Finding}s.
 */

import type { SourceLocation } from '../types.js';

/** How an adapter-discovered variable is injected. */
export type AdapterVarKind = 'env' | 'arg' | 'build-arg' | 'env_file';

/** A normalized environment variable discovered by an adapter. */
export interface AdapterVar {
  key: string;
  /** Literal value if one was written; omitted for `env_file` refs / bare args. */
  value?: string;
  location: SourceLocation;
  /** Human-readable origin, e.g. `Dockerfile ENV`, `compose environment (web)`. */
  source: string;
  kind: AdapterVarKind;
  /** True when the value references another variable, e.g. `${HOST_VAR}`. */
  interpolated?: boolean;
}
