# Changelog

All notable changes to env-drift are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry names *what* changed and, where the reasoning is not obvious from
the change itself, *why* — so future readers can decide whether a release is
relevant to them without re-reading the diff.

## [Unreleased]

_No unreleased changes yet._

---

## [0.4.1] — 2026-06-29

A security-hardening release. No new rule codes; behaviour changes are limited
to redaction and resource limits. Zero runtime dependencies.

### Security

- **Fixed a secret-leak in validation messages.** Type/constraint messages such
  as `expected a URL, got "<value>"` echoed the raw value — for a variable
  marked `secret`, that leaked the secret into terminal/JSON/SARIF output and CI
  artifacts. Secret values are now rendered as `<redacted>` in every message,
  non-secret values have URL credentials stripped and are truncated, and a
  secret URL's hostname is redacted in environment-safety messages. This also
  covers the runtime loader's `EnvironmentValidationError` (it reuses the same
  messages).
- **No enumeration of live process-env names.** `env-drift check --env <e>`
  without `--file` reads `process.env`, which carries hundreds of unrelated
  OS/CI keys. It no longer reports those as `ENV002` (undeclared) — listing
  their names could itself reveal which secrets exist in the environment.
  Checks against an explicit `--file` still report undeclared keys. Configurable
  via the new `reportUndeclared` option on `checkEnvironment`.

### Hardened (DoS / resource exhaustion)

- **Filesystem walk** never follows symbolic links (symlink-loop and
  path-traversal defence) and is bounded by depth (40), file count (50,000),
  and per-file size (5 MB) — a crafted symlink loop, a pathologically deep tree,
  or a giant file can no longer hang the scan or exhaust memory.
- **Regex input is capped** at 4,096 characters for value/pattern validation,
  bounding the cost of a pathological user-supplied `pattern` (ReDoS defence)
  and the size of any value rendered into a message.
- **The YAML subset parser** bounds nesting depth (64), so deeply nested Compose
  input cannot overflow the stack.

### Added

- **Self-contained secret-scan CI workflow**
  ([`.github/workflows/secret-scan.yml`](.github/workflows/secret-scan.yml)) —
  fails the build if any `.env` (other than `.env.example`) is committed, if a
  high-signal secret pattern appears in a tracked file, or if the published
  tarball would include source/`.env` files. No third-party action, nothing to
  pin.
- `checkEnvironment` gained a `reportUndeclared` option.

---

## [0.4.0] — 2026-06-29

Monorepo / multi-service support. The contract's `services`, `consumers`, and
`producers` fields are now enforced across a repository. Still zero runtime
dependencies.

### Added

- **Per-service scanning** ([`src/engine/services.ts`](./src/engine/services.ts)).
  When the contract declares `services: { web: { root }, api: { root }, … }`,
  each service's code is scanned separately so references can be attributed to
  the service that makes them.
- **Cross-service drift checks:**
  - **`ENV011`** when a declared `consumer` of a variable never references it,
    or when a service references a variable but is **not** a declared consumer.
  - **`ENV013` (scope)** when a service is granted a **secret** it never uses —
    "reduce its scope". Sharing secrets with services that don't need them makes
    rotation and compromise-attribution harder.
  - A service with **dynamic** env access is never accused of *not* using a
    variable — that cannot be proven statically.
  - These hygiene checks default to `warning`; a variable's `severity` overrides.
- **CLI:** `scan` automatically runs cross-service checks when `services` are
  declared; `--service <name>` limits a scan to a single service's root.
  `explain` now shows a variable's `Consumers` / `Producers`.
- New public API: `scanServices`, `checkServices`, and the `ServiceScan` type.

### Notes

- Live codes are now `ENV001`–`ENV011`, `ENV013`, `ENV014`, and `ENV016`.
  `ENV013` is currently raised in the monorepo (service-scope) context; the
  CI/CD provider-scope variant arrives with the provider adapters.
- Reserved for later releases: `ENV012` (stale runtime), `ENV015` (secret
  lifecycle).

---

## [0.3.0] — 2026-06-29

Adapters. env-drift now understands Docker and Next.js/Vite, which lights up
`ENV009` (build/runtime drift). Still zero runtime dependencies — the YAML
needed for Compose is parsed by an in-house subset parser.

### Added

- **Zero-dependency YAML subset parser**
  ([`src/adapters/yaml/mini-yaml.ts`](./src/adapters/yaml/mini-yaml.ts)) — block
  mappings, sequences, scalars, quotes, comments, and simple inline arrays;
  enough to read Compose files without a YAML dependency.
- **Docker adapter.** Discovers env configuration from Dockerfiles
  (`ENV` in both `KEY=value` and legacy forms, `ARG`, line continuations) and
  Compose files (`services.*.environment` map/list, `env_file`, `build.args`).
  Reports **`ENV007`** when a secret is carried by a build argument or image
  `ENV` — build args are recorded in image history and `ENV` persists in the
  final image, so neither may hold secrets. Secret classification uses the
  contract first, then a name heuristic (a heuristic-only match is a warning).
  Values are never shown. The adapter runs automatically during `scan`.
- **Next.js / Vite build-manifest adapter → `ENV009`.** `writeManifest`
  fingerprints the public (`NEXT_PUBLIC_*`, `VITE_*`, …) values compiled into a
  build and records the environment it was built for; `checkManifest` compares
  that against the deploy target and reports `ENV009` when a public value was
  compiled for a different environment, is now absent, or was added after the
  build — i.e. when a **rebuild** (not a restart) is required. Manifests store
  only fingerprints, never raw values.
- **CLI `manifest write|check`.** `env-drift manifest write --env <e> [--out f]`
  emits a build manifest; `env-drift manifest check --env <e> --manifest f`
  reports build/runtime drift. `build-id` comes from `--build-id`, `BUILD_ID`,
  or `GITHUB_SHA`.
- New public API: `discoverDocker`, `checkDocker`, `parseDockerfile`,
  `parseCompose`, `writeManifest`, `checkManifest`, `parseYaml`, and the
  `reportFromFindings` reporter helper.

### Changed

- `checkEnvironment` accepts an optional `extraFindings: Finding[]` so adapter
  findings flow through the same suppression, severity, and status resolution
  as core findings.

### Notes

- Live codes are now `ENV001`–`ENV011`, `ENV014`, and `ENV016`. Reserved for
  later releases: `ENV012` (stale runtime), `ENV013` (provider scope),
  `ENV015` (secret lifecycle).
- Adapter findings currently carry file-level locations (line `1`); precise
  line tracking through the YAML parser is a follow-up.

---

## [0.2.0] — 2026-06-29

A hardening release that wires two reserved codes and tightens the scanner. No
breaking changes; still zero runtime dependencies.

### Added

- **`ENV005` — duplicate keys.** The parser already flagged a key defined twice
  in one file; the engine now emits `ENV005` for it. The CLI passes parsed
  files to the engine (`scan`, and `check --file`) so duplicates are reported
  with their source location.
- **`ENV006` — precedence shadowing + provenance.** A new precedence resolver
  ([`src/scan/precedence.ts`](./src/scan/precedence.ts)) ranks `.env` files the
  way dotenv/Next.js layer them (`.env.{env}.local` > `.env.local` >
  `.env.{env}` > `.env`). `scan` now resolves the *effective* value per key
  through this order. `ENV006` fires only when an **unreviewed** local-override
  file (`.env*.local`) shadows a **committed** file's value with a *different*
  value — intentional layering of committed files is not flagged, and values
  are never shown (only file names).
- **Suppression-expiry notices.** When a suppression has passed its `expiresAt`,
  the silenced finding re-surfaces at its real severity (failing CI) with a
  note: `… (suppression expired YYYY-MM-DD)`.

### Fixed

- **Scanner: optional chaining.** `process.env?.X` and `process.env?.["X"]`
  are now detected. Previously the `?.` between the env object and the key
  prevented a match, so those references were silently missed.

### Changed

- `checkEnvironment` accepts an optional `files: ParsedEnvFile[]` input that
  enables the `ENV005`/`ENV006` checks; the flattened `values` map alone cannot
  express duplicates or provenance.

---

## [0.1.0] — 2026-06-25

The initial MVP release: a typed, reviewable environment contract plus an
offline engine that correlates the contract against code references and `.env`
values, all with zero runtime dependencies.

### Added

- **Typed contract API.** `defineConfig` and the `variable.*` builders
  (`string`, `integer`, `number`, `boolean`, `url`, `port`, `email`, `enum`,
  `json`, `list`, `duration`, `secret`, `custom`) declare variables with
  `requiredIn` / `forbiddenIn`, `secret`, `exposure`, `phase`, `default`,
  `owner`, `severity`, per-environment `rules`, `differences`, `deprecated`,
  and monorepo `consumers` / `producers`. Structural validation of the contract
  reports issues as a distinct exit code (`2`).
- **Zero-dependency dotenv parser.** Handles single/double quotes, multiline
  quoted values, escape sequences, `export ` prefixes, inline comments, empty
  values, duplicate keys, CRLF/LF, and a leading UTF-8 BOM. `${VAR}` expansion
  is intentionally not performed — the raw written value is preserved because
  expansion is source-specific.
- **Zero-dependency code scanner.** A hand-rolled JS/TS tokenizer (not regex
  alone) finds `process.env.X`, `process.env["X"]`, `import.meta.env.X`,
  `Bun.env.X`, `Deno.env.get("X")`, and `const { X } = process.env`, and never
  matches inside comments or strings. Computed access is reported as `ENV014`
  (uncertain) rather than guessed — and disables the "unused" check, which
  cannot be proven statically when dynamic access exists.
- **Drift engine** emitting stable codes: `ENV001` (missing required), `ENV002`
  (undeclared), `ENV003` (unused), `ENV004` (invalid value), `ENV007` (exposure
  violation — a secret on a client prefix), `ENV008` (unsafe environment value:
  forbidden host, non-HTTPS, disallowed value), `ENV010` (deprecated), `ENV011`
  (cross-service must-match), `ENV014` (uncertainty), and `ENV016` (case-only
  key collision). `ENV007` is non-suppressible.
- **Policy-aware comparison** (`diffEnvironments`) for `mustDifferBetween` and
  `mustMatchBetween`, so intentional differences are never reported as drift.
- **Secret-safe design.** Secret values are redacted (`••••••••`) in every
  report; URL credentials are stripped from non-secret values; in-memory
  comparison exposes only `same`/`different`/`unknown`; persistent comparison
  uses a keyed HMAC (`fingerprint`); and a `SecretValue` wrapper refuses to
  reveal itself through `String`, `JSON.stringify`, or `util.inspect`.
- **Runtime validator** (`env-drift/runtime` → `loadEnvironment`): validates,
  coerces, and freezes the environment, restricted to declared variables, with
  a per-environment failure policy that throws before the app accepts traffic.
- **Reporters:** `terminal` (TTY-aware colour, `NO_COLOR` respected), `json`
  (stable schema), and `sarif` (2.1.0, for GitHub code scanning). Deterministic
  exit codes: `0` clean, `1` violations, `2` invalid contract/parse, `4`
  incomplete/unknown.
- **CLI** (`env-drift`): `init`, `scan`, `check`, `diff`, `explain`, `generate`
  (`example` / `types` / `docs`), and `doctor`. Argument parsing is hand-rolled
  to preserve the zero-dependency guarantee.
- **Generators** that derive `.env.example`, TypeScript declarations, and
  Markdown documentation from the contract — never emitting secret values.

### Security

- The package ships **zero runtime dependencies** and bundles no third-party
  code or data.
- Suppressions are time-boxed; expired suppressions stop silencing their
  finding so it re-surfaces in CI.
- A provider/scan limitation maps to `UNKNOWN` (exit `4`), never to "no drift".
