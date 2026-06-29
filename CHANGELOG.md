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
