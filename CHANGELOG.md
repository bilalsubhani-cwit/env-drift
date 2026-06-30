# Changelog

All notable changes to envcanary are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each entry names *what* changed and, where the reasoning is not obvious from
the change itself, *why* — so future readers can decide whether a release is
relevant to them without re-reading the diff.

## [Unreleased]

_No unreleased changes yet._

---

## [1.0.0] — 2026-06-29

The first public release. envcanary is a configuration contract, provenance and
drift-detection engine for applications and CI/CD — secret-safe, fully offline,
and with **zero runtime dependencies**.

### Contract & engine

- **Typed, reviewable contract.** `defineConfig` and the `variable.*` builders
  (`string`, `integer`, `number`, `boolean`, `url`, `port`, `email`, `enum`,
  `json`, `list`, `duration`, `secret`, `custom`) declare variables with
  `requiredIn` / `forbiddenIn`, `secret`, `exposure`, `phase`, `default`,
  `owner`, `severity`, per-environment `rules`, `differences`, `deprecated`,
  `consumers` / `producers`, and more. Structural validation reports an invalid
  contract as a distinct exit code (`2`).
- **Drift engine** emitting stable rule codes: `ENV001` (missing required),
  `ENV002` (undeclared), `ENV003` (unused), `ENV004` (invalid value), `ENV005`
  (duplicate key), `ENV006` (precedence shadowing), `ENV007` (exposure
  violation), `ENV008` (unsafe environment value), `ENV009` (build/runtime
  drift), `ENV010` (deprecated), `ENV011` (cross-service drift), `ENV013`
  (scope violation), `ENV014` (uncertainty), and `ENV016` (case-only key
  collision). `ENV012` and `ENV015` are reserved for upcoming adapters. Rule
  identifiers and the JSON/SARIF shape are a stability contract.
- **Policy-aware comparison** (`diffEnvironments`) for `mustDifferBetween` /
  `mustMatchBetween`, so intentional differences are never reported as drift.
- **Time-boxed suppressions**; an expired suppression re-surfaces its finding
  (failing CI) with an explanatory note. High-severity exposure (`ENV007`) is
  non-suppressible.

### Discovery (all zero-dependency)

- **dotenv parser** — quotes, multiline values, escapes, `export `, inline
  comments, duplicates, CRLF/LF, BOM. `.env` precedence resolution
  (`.env.{env}.local` > `.env.local` > `.env.{env}` > `.env`) drives provenance
  and `ENV006`.
- **Code scanner** — a hand-rolled JS/TS tokenizer (not regex) finds
  `process.env.X`, `process.env["X"]`, `import.meta.env.X`, `Bun.env.X`,
  `Deno.env.get("X")`, destructuring, optional chaining, and wrapper calls;
  computed access is reported as `ENV014` rather than guessed.
- **Adapters** — Docker (`ENV`/`ARG`) and Compose (`environment`, `env_file`,
  `build.args`, via an in-house YAML subset parser), flagging secrets baked
  into build args/image `ENV` (`ENV007`); Next.js/Vite **build manifest**
  (`writeManifest`/`checkManifest`) detecting build/runtime drift (`ENV009`).
- **Monorepo / multi-service** — per-service scanning with cross-service
  consumer/producer drift (`ENV011`) and service-scope secret checks (`ENV013`).

### Runtime, CLI & output

- **Runtime validator** (`envcanary/runtime` → `loadEnvironment`): validates,
  coerces, and freezes the environment, restricted to declared variables, with
  a per-environment failure policy that throws before the app accepts traffic.
- **CLI**: `init`, `scan`, `check`, `diff`, `explain`, `generate`
  (`example`/`types`/`docs`), `manifest write|check`, `doctor` — hand-rolled
  arg parsing, `--service` filter. Deterministic exit codes (`0`/`1`/`2`/`4`).
- **Reporters**: `terminal` (TTY-aware colour, `NO_COLOR`), `json` (stable
  schema), `sarif` (2.1.0 for GitHub code scanning).
- **Generators** for `.env.example`, TypeScript declarations, and Markdown docs
  — never emitting secret values.

### Security

- **Secret-safe by construction.** Secret values are redacted (`••••••••` /
  `<redacted>`) in every report, message, snapshot, and error — including
  validation messages and the runtime loader's error. URL credentials are
  stripped from non-secret values; in-memory comparison exposes only
  `same`/`different`/`unknown`; persistent comparison uses keyed HMAC; a
  `SecretValue` wrapper refuses to reveal itself via `String`/`JSON`/inspect.
  Checking the live `process.env` does not enumerate undeclared key names.
- **DoS-hardened.** The filesystem walk never follows symlinks and is bounded by
  depth, file count, and a 5 MB per-file limit; regex input is capped (ReDoS
  defence); the YAML parser bounds nesting depth.
- **Supply chain.** Zero runtime dependencies; `.npmrc` `ignore-scripts`;
  pinned, least-privilege GitHub Actions; CodeQL; a self-contained secret-scan
  workflow that keeps `.env` files and high-signal secrets out of the repo and
  the published tarball. Released via npm trusted publishing (OIDC) with
  provenance.
