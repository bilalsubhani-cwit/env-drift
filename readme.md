<!--
  Badges are intentionally minimal at launch. Download/bundle-size and CI/CodeQL
  badges are added once they have real data — empty badges read as "abandoned"
  to a first-time visitor. Re-add from git history once there's traction:
  npm downloads, bundlephobia min+gzip, CI status, CodeQL status.
-->
<p align="center">
  <a href="https://www.npmjs.com/package/envcanary"><img src="https://img.shields.io/npm/v/envcanary?style=flat-square&color=1a1a2e" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/dependencies-zero-1a1a2e?style=flat-square" alt="zero dependencies" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-1a1a2e?style=flat-square" alt="node >= 18" />
  <img src="https://img.shields.io/badge/license-MIT-1a1a2e?style=flat-square" alt="MIT license" />
</p>

<h1 align="center">envcanary</h1>

<p align="center">
  <strong>The CI gate for your environment configuration. It catches drift across your code, <code>.env</code> files, Docker, and builds — a missing key, a staging URL in production, a secret on a <code>NEXT_PUBLIC_</code> prefix — <em>before</em> it ships.</strong>
</p>

<p align="center">
  Not another env loader or runtime validator: envcanary checks your config against a typed, reviewable contract <em>before runtime</em>, then gates violations in CI.<br/>
  Zero runtime dependencies. Fully offline. Secret-safe by default — values are redacted everywhere.
</p>

<p align="center">
  <strong>Who it's for:</strong> teams running more than one environment or service, whose config lives in more than one place
  (<code>.env</code> + Docker + CI + build) — and who've been burned by a config-drift incident at least once.<br/>
  If you have one <code>.env</code> and one process, a runtime validator is the lighter choice and envcanary is overkill.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-envcanary-relates-to-the-tools-you-already-use">How it compares</a> ·
  <a href="#the-contract">Contract</a> ·
  <a href="#drift-taxonomy">Drift codes</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#secret-safe-design">Security</a>
</p>

---

<p align="center">
  <strong>Why envcanary</strong>
</p>

- **A typed contract, not another `.env` diff.** You declare what variables exist, where they're required, whether they're secrets, whether they're client- or server-side, and which environment differences are intentional. envcanary checks reality against that contract — code, `.env` files, and the running process.
- **Static discovery across your code.** A dependency-free scanner finds `process.env.X`, `process.env["X"]`, `import.meta.env.X`, `Bun.env.X`, `Deno.env.get("X")`, and `const { X } = process.env`. Computed access (`process.env[prefix + key]`) is reported as *uncertain* rather than silently missed.
- **Environment-aware rules.** "It's a valid URL" isn't enough. envcanary knows that `http://localhost` is unacceptable in production, that `DEBUG` must be off, that a secret must not wear a `NEXT_PUBLIC_` prefix, and that staging and production databases must not be the same.
- **Secret-safe by construction.** Values classified as secrets are redacted in every report, snapshot, and error message. The package is designed so a secret never appears in cleartext — see [Secret-safe design](#secret-safe-design).
- **Zero dependencies, fully offline.** The dotenv parser and the code scanner are hand-rolled; there is no Babel, no TypeScript loader, no `dotenv` at runtime. Stable `ENV001…ENV016` rule codes and `terminal` / `json` / `sarif` output drop straight into CI.

```ts
import { defineConfig, variable, checkEnvironment } from "envcanary";

const contract = defineConfig({
  contractVersion: 1,
  environments: ["local", "production"],
  variables: {
    DATABASE_URL: variable.url({ requiredIn: ["production"], secret: true }),
    DEBUG: variable.boolean({ rules: { production: { allowedValues: [false] } } }),
  },
});

checkEnvironment({ contract, environment: "production", values: process.env }).status;
// → 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN'
```

---

## Table of Contents

- [Overview](#overview)
- [How envcanary relates to the tools you already use](#how-envcanary-relates-to-the-tools-you-already-use)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [The Contract](#the-contract)
- [Drift Taxonomy](#drift-taxonomy)
- [Static Discovery](#static-discovery)
- [Intentional vs Accidental Differences](#intentional-vs-accidental-differences)
- [Secret-safe Design](#secret-safe-design)
- [CLI](#cli)
- [Runtime Validation](#runtime-validation)
- [CI/CD Integration](#cicd-integration)
- [API Reference](#api-reference)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Third-Party Notices](#third-party-notices)
- [Limitations](#limitations)
- [License](#license)

---

## Overview

**Environment drift** is an unintended difference between the configuration an application *declares*, the configuration its code *consumes*, the values supplied by deployment systems, and the configuration actually available to the running process. Drift is not "dev and prod differ" — they're *expected* to differ. Drift is when those differences violate an explicit contract or operational policy.

The [Twelve-Factor](https://12factor.net/config) methodology stores config in the environment, but modern apps receive it from `.env` files, shell variables, CI/CD systems, Docker, Kubernetes, systemd, hosting providers, and secret managers — each with different precedence and lifecycle rules. envcanary gives you a single, reviewable place to declare what's expected and a fast, offline engine to detect where reality has drifted from it.

The **1.0** release covers: the typed contract, the dotenv parser, the static code scanner, missing/extra/invalid/unsafe detection, `.env` precedence and shadowing, secret-safe redaction, the runtime validator, Docker/Compose and Next.js/Vite build-manifest drift, monorepo cross-service checks, and `terminal` / `json` / `sarif` output. Read-only providers (GitHub/GitLab/Vercel/Vault) and Kubernetes/systemd runtime drift are on the [roadmap](#roadmap).

## How envcanary relates to the tools you already use

**envcanary is not a replacement for `dotenv`, `envalid`, `znv`, T3 Env, or `convict`** — it does a different job, and it composes with them. Those tools *load* and/or *validate* configuration **at runtime, in one process**. envcanary *detects drift* **before runtime, across your code and deployment surfaces** — and gates it in CI. You can keep validating with T3 Env or envalid in your app and add envcanary as the CI check that catches the missing key, the staging URL in production, or the secret on a `NEXT_PUBLIC_` prefix before deploy.

The trade-off is explicit: envcanary asks you to maintain a **contract file**. If all you want is co-located runtime validation, a loader/validator is the lighter choice. envcanary earns its keep when configuration spans multiple environments, services, and sources (`.env` + Docker + CI + build) and you want a reviewable, drift-gating contract over all of it.

| Capability | envcanary | loaders (`dotenv`, `dotenv-flow`) | validators (`envalid`, `znv`, T3 Env) | `convict` |
|---|---|---|---|---|
| Provides config to your app at runtime | ❌ (by design) | ✅ (raw) | ✅ (validated) | ✅ (validated) |
| Runtime typed validation | ✅ | ❌ | ✅ | ✅ |
| Reviewable contract / schema | ✅ | ❌ | partial | ✅ |
| **Static discovery of env usage in code** | ✅ | ❌ | ❌ | ❌ |
| **Environment-aware safety rules** (prod ≠ localhost, HTTPS) | ✅ | ❌ | ❌ | ❌ |
| **Multi-source drift** (.env + Docker + build manifest) | ✅ | ❌ | ❌ | ❌ |
| **CI gating: stable codes + SARIF** | ✅ | ❌ | ❌ | ❌ |
| **Secret-aware redaction in output** | ✅ | ❌ | ❌ | partial¹ |
| Zero runtime dependencies | ✅ | varies | ❌ | ❌ |

The bolded rows are the wedge: as far as we know, no widely-used free package does **static env-usage discovery + a reviewable contract + CI drift gating with SARIF and secret-safe reporting**. If you find one, please open an issue — we'll update this table.

<sub>¹ `convict` masks values marked `sensitive: true` as `[Sensitive]` in `config.toString()`. envcanary redacts secrets across every output (terminal/JSON/SARIF/errors/diff), in comparisons, and in the runtime `SecretValue` wrapper.</sub>

<sub>Comparison verified against each package's documentation in June 2026 — [envalid](https://github.com/af/envalid), [@t3-oss/env-core](https://env.t3.gg/docs/core), [znv](https://github.com/lostfictions/znv), [convict](https://github.com/mozilla/node-convict). T3 Env's docs state it feeds env vars "directly to the validator … rather than scanning your source code"; none of these tools perform static code discovery, multi-source drift detection, or SARIF output. Found an inaccuracy? Open an issue.</sub>

## Installation

```bash
npm install --save-dev envcanary
# or, to use the runtime validator in your app:
npm install envcanary
```

Requires Node.js ≥ 18. Ships ESM and CommonJS builds plus type declarations.

## Quick Start

```bash
# 1. Scaffold a contract
npx envcanary init

# 2. Edit envcanary.config.js, then scan your code + .env files
npx envcanary scan --env production

# 3. Validate a specific environment file
npx envcanary check --env production --file .env.production

# 4. Generate a .env.example, types, or docs from the contract
npx envcanary generate example --out .env.example
```

## The Contract

The contract is committed and reviewed in code — not inferred from `.env.example`. Author it in `envcanary.config.js` (or `.cjs` / `.mjs` / `.json`):

```js
const { defineConfig, variable } = require("envcanary");

module.exports = defineConfig({
  contractVersion: 1,
  environments: ["local", "test", "ci", "staging", "production"],

  variables: {
    NODE_ENV: variable.enum({
      values: ["development", "test", "production"],
      requiredIn: ["local", "ci", "staging", "production"],
    }),

    DATABASE_URL: variable.url({
      requiredIn: ["ci", "staging", "production"],
      secret: true,
      exposure: "server",
      differences: { mustDifferBetween: [["staging", "production"]] },
      rules: {
        production: {
          allowedProtocols: ["postgres:", "postgresql:"],
          forbiddenHosts: ["localhost", "127.0.0.1"],
        },
      },
      owner: "platform-team",
      description: "Primary application database connection string",
    }),

    JWT_SECRET: variable.secret({
      requiredIn: ["ci", "staging", "production"],
      minLength: 32,
      forbiddenValues: ["change-me", "secret", "development-secret"],
      rotation: { maximumAgeDays: 90 },
      owner: "security-team",
    }),

    NEXT_PUBLIC_API_URL: variable.url({
      requiredIn: ["local", "staging", "production"],
      exposure: "client",
      phase: "build",
      rules: { production: { requireHttps: true, allowedHosts: ["app.example.com"] } },
      deploymentEffect: "rebuild-required",
    }),

    DEBUG: variable.boolean({
      default: false,
      rules: { production: { allowedValues: [false] } },
    }),
  },
});
```

> **TypeScript configs.** To keep the zero-dependency guarantee, envcanary does not load `.ts` configs directly (that would require a TS runtime loader). Author the contract in JS/JSON, or compile your TS config first. You still get full editor types because `defineConfig` and `variable` are fully typed.

Every variable supports `type`, `requiredIn` / `forbiddenIn`, `secret`, `exposure`, `phase`, `default`, `description`, `owner`, `severity`, type-specific constraints (`min`/`max`/`minLength`/`pattern`/`values`/`allowedProtocols`/`forbiddenValues`), environment-specific `rules`, `differences`, `deprecated`, `deploymentEffect`, `rotation`, and monorepo `consumers` / `producers`.

## Drift Taxonomy

envcanary emits **stable rule identifiers** so teams can suppress, trend, and gate CI on specific drift classes. These codes do not change across minor versions, and they appear in SARIF output.

| Code | Drift type | Example |
|---|---|---|
| `ENV001` | Missing required variable | `DATABASE_URL` absent in production |
| `ENV002` | Undeclared variable | An undocumented key is present / referenced |
| `ENV003` | Unused variable | A declared variable is never referenced in code |
| `ENV004` | Invalid value | A port is outside the valid range |
| `ENV005` | Duplicate definition | The same key appears twice in one `.env` file |
| `ENV006` | Precedence conflict | A shell value shadows reviewed configuration |
| `ENV007` | Exposure violation | A secret uses a `NEXT_PUBLIC_` prefix |
| `ENV008` | Unsafe environment value | A production URL points to localhost |
| `ENV009` | Build/runtime drift | A compiled public value differs from the target |
| `ENV010` | Deprecated configuration | A removed variable is still deployed |
| `ENV011` | Cross-service drift | API and worker expect incompatible values |
| `ENV012` | Stale runtime configuration | A secret changed but the workload wasn't restarted |
| `ENV013` | Scope violation | A production secret is available to staging jobs |
| `ENV014` | Provider uncertainty | A source couldn't be queried — status is *unknown* |
| `ENV015` | Secret lifecycle violation | A secret version exceeds its approved age |
| `ENV016` | Platform portability issue | Keys differ only by case (Windows vs Unix) |

A provider or scan limitation is never reported as "no drift" — it surfaces as `ENV014` / `UNKNOWN` (exit code `4`).

> envcanary implements `ENV001`–`ENV011`, `ENV013`, `ENV014`, and `ENV016` today (including `ENV009` build/runtime drift via the Next.js/Vite build manifest, and `ENV013` service-scope checks in monorepos). The remaining codes (`ENV012`, `ENV015`) are reserved with stable identifiers and land with their adapters — see the [roadmap](#roadmap).

## Static Discovery

The scanner uses a hand-rolled JS/TS tokenizer (not regex alone), so it never matches inside comments or strings, and it reads bracket-access keys back from their string literal. It recognizes:

```ts
process.env.DATABASE_URL;
process.env["DATABASE_URL"];
import.meta.env.VITE_API_URL;
Bun.env.PORT;
Deno.env.get("DATABASE_URL");
const { DATABASE_URL } = process.env;       // destructuring
createEnv({ DATABASE_URL: process.env.DATABASE_URL }); // wrappers
```

Computed access is reported honestly:

```text
ENV014  dynamic environment access via process.env[...]; static
        completeness cannot be guaranteed   (src/config.ts:18:11)
```

When dynamic access exists in a file, envcanary will not claim a variable is *unused* (`ENV003`) — it can't prove that statically, and it says so.

## Intentional vs Accidental Differences

A naive tool reports `DATABASE_URL differs between staging and production` — which is useless, because it *should* differ. envcanary only reports differences that violate a declared policy:

```js
DATABASE_URL: variable.url({
  differences: {
    mustDifferBetween: [["staging", "production"]],   // identical → ENV008
  },
}),
QUEUE_NAME: variable.string({
  differences: {
    mustMatchBetween: [["api", "worker"]],            // differ → ENV011
  },
}),
```

Values are compared without being revealed; secret values never appear in the diff output.

## Adapters

envcanary understands more than `.env` files. Adapters discover configuration from deployment systems and add their own checks — all still zero-dependency (the Compose YAML is parsed by an in-house subset parser).

### Docker & Compose

`scan` automatically discovers env configuration in Dockerfiles (`ENV`, `ARG`) and Compose files (`environment`, `env_file`, `build.args`). The headline check: a **secret carried by a build argument or image `ENV`** is an exposure violation (`ENV007`) — build args are recorded in image history and `ENV` persists in the final image, so neither may hold secrets.

```text
ENV007  "DATABASE_PASSWORD" is passed via compose build.args (web);
        build arguments are recorded in image history, so it must not
        carry a secret   (compose.yml:1)
```

### Next.js / Vite — build/runtime drift (ENV009)

Public variables (`NEXT_PUBLIC_*`, `VITE_*`, …) are compiled into the client bundle at **build** time. Changing the server's runtime environment afterward does not change what's already baked into the built JavaScript — so a build promoted from staging to production can serve *staging* values to the browser.

Write a manifest at build time, check it at deploy time:

```bash
# at build (records a fingerprint of each public value + the build's environment)
envcanary manifest write --env staging --out build-manifest.json

# at deploy (compares the manifest against the production target)
envcanary manifest check --env production --manifest build-manifest.json
```

```text
ENV009  "NEXT_PUBLIC_API_URL" was compiled with the staging value but the
        production value differs; a rebuild is required (restarting will
        not fix this)
```

Manifests store only fingerprints, never raw values.

## Monorepos & Multi-service

Declare your services and scope variables to the ones that use them. envcanary scans each service's code separately and reports cross-service drift.

```js
module.exports = defineConfig({
  contractVersion: 1,
  environments: ["production"],
  services: {
    web: { root: "apps/web" },
    api: { root: "apps/api" },
    worker: { root: "apps/worker" },
  },
  variables: {
    DATABASE_URL: variable.url({ secret: true, consumers: ["api", "worker"] }),
    NEXT_PUBLIC_API_URL: variable.url({ exposure: "client", consumers: ["web"] }),
    QUEUE_NAME: variable.string({ producers: ["api"], consumers: ["worker"] }),
  },
});
```

`envcanary scan` then catches:

- **`ENV011`** — a declared consumer that never references the variable, or a service that references a variable it isn't a declared consumer of.
- **`ENV013`** — a service granted a **secret it never uses** ("reduce its scope"). Over-shared secrets make rotation and compromise-attribution harder.

```text
ENV013  secret "DATABASE_URL" is granted to service "web" but it never
        references the variable; reduce its scope
ENV011  service "worker" is a declared consumer of "QUEUE_NAME" but never
        references it
```

A service that uses **dynamic** env access is never accused of *not* using a variable — envcanary can't prove that statically, and says so. Use `--service <name>` to scan a single service, and the runtime loader's `service` option restricts the loaded env to that service's variables.

## Secret-safe Design

envcanary routinely sits next to secret material, so security is structural, not optional:

- **Redacted by default.** Anything marked `secret: true` (and every `variable.secret(...)`) is shown as `••••••••` in every report, snapshot, and error. The engine only ever produces redacted messages — values are never interpolated into findings.
- **URL credentials are stripped** even for non-secret values: `postgres://user:pw@host/db` → `postgres://***:***@host/db`.
- **No raw values in comparisons.** In-memory comparison returns only `same` / `different` / `unknown`. When a persistent comparison token is unavoidable, envcanary uses a **keyed HMAC** (`fingerprint(value, key)`), never a bare hash of a low-entropy secret.
- **`SecretValue` wrapper.** The runtime loader wraps secrets so they refuse to reveal themselves through `String()`, `JSON.stringify`, `console.log`, or `util.inspect`. The raw value is reachable only via an explicit `.reveal()`.
- **No exfiltration commands.** There is deliberately no `envcanary export production`. The CLI cannot print secret values.
- **Messages never echo secrets.** Validation messages render a secret value as `<redacted>` (and strip URL credentials / redact secret hostnames) — so an invalid secret can never leak through a finding, a report, a SARIF upload, or the runtime loader's error. Checking the live `process.env` does not enumerate its undeclared key names, which could otherwise reveal what secrets exist.

### Hardening (DoS-resistant by design)

envcanary is built to stay bounded on hostile input — no catastrophic backtracking, no symlink loops, no unbounded memory:

- The filesystem walk **never follows symlinks** and is capped by depth, file count, and a 5 MB per-file limit.
- Regex validation input is **capped at 4 KB** (ReDoS defence for user-supplied `pattern`s).
- The Compose YAML parser **bounds nesting depth**, so deeply nested input can't overflow the stack.
- A self-contained [secret-scan CI workflow](.github/workflows/secret-scan.yml) keeps `.env` files and high-signal secrets out of the repository and the published package.

```ts
import { SecretValue } from "envcanary";

const s = new SecretValue("hunter2");
console.log(`${s}`);            // ••••••••
JSON.stringify({ s });          // {"s":"••••••••"}
s.reveal();                     // "hunter2"  (explicit, auditable)
```

## CLI

```text
envcanary init                          Scaffold a starter contract
envcanary scan [--env name]             Scan code & .env files against the contract
envcanary check --env <name> [--file f] Validate an environment against the contract
envcanary diff <envA> <envB>            Policy-aware comparison of two environments
envcanary explain <VAR> --env <name>    Show provenance and policy for one variable
envcanary generate <example|types|docs> Emit an artifact from the contract
envcanary doctor                        Sanity-check the project setup
```

Output formats: `--format terminal | json | sarif`. Deterministic exit codes:

```text
0  No blocking drift
1  Policy violations (one or more errors)
2  Invalid contract or parse failure
4  Incomplete result — one or more sources are UNKNOWN
```

A provider failure must never be treated as "no drift", so it maps to exit `4`, not `0`.

## Runtime Validation

Validate and load the environment at startup — typed, normalized, immutable, and secret-aware. By default it fails before the app accepts traffic in non-local environments:

```ts
import { loadEnvironment } from "envcanary/runtime";
import contract from "../envcanary.config";

export const env = loadEnvironment({
  contract,
  environment: process.env.APP_ENV ?? "local",
  failurePolicy: { local: "warn", production: "error" },
});

env.PORT;          // number
env.DEBUG;         // boolean
env.DATABASE_URL;  // SecretValue (redacted)
```

The returned object is frozen and restricted to variables declared for that service — stray keys in `process.env` are never surfaced.

## CI/CD Integration

```yaml
- run: npx envcanary scan --env production --format sarif > envcanary.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: envcanary.sarif }
```

SARIF is an OASIS standard for static-analysis results, and GitHub ingests third-party SARIF into code scanning — so an `ENV007` exposure finding can appear inline on the pull request that introduced it.

**Suppressions** are controlled and time-boxed. Add them to the contract; expired suppressions stop silencing their finding, so it re-surfaces and fails CI. High-severity exposure rules (`ENV007`) are non-suppressible.

```js
suppressions: [
  {
    rule: "ENV008",
    variable: "LEGACY_CALLBACK_URL",
    environment: "production",
    reason: "Legacy partner does not yet support HTTPS callbacks",
    owner: "integrations-team",
    expiresAt: "2026-08-01",
    ticket: "PLAT-1842",
  },
],
```

## API Reference

```ts
import {
  defineConfig, variable,        // author the contract
  checkEnvironment,              // single-environment drift check
  correlateCode,                 // code-references vs contract
  diffEnvironments,              // policy-aware env comparison
  validateValue,                 // single-value validation
  parseDotenv, toEnvMap,         // zero-dep dotenv parser
  scanSource, scanProjectCode,   // zero-dep code scanner
  generateExample, generateTypes, generateDocs,
  render, renderSarif, reportExitCode,
  SecretValue, maskValue, fingerprint, compareValues,
  CODES,                         // the ENV001…ENV016 registry
} from "envcanary";

import { loadEnvironment } from "envcanary/runtime";
```

See the typed signatures and JSDoc in your editor for full details.

## Roadmap

| Stage | Scope | Status |
|---|---|---|
| **`1.0`** | Typed contract, dotenv parsing + precedence/shadowing, AST-grade code scan, missing/extra/invalid/unsafe detection, duplicate keys, secret-safe redaction, runtime loader, Docker/Compose & Next.js/Vite build-manifest drift (`ENV009`), monorepo cross-service checks (`ENV011`/`ENV013`), terminal/JSON/SARIF, DoS-hardened | ✅ shipped |
| `1.1` | GitHub, GitLab and Vercel read-only providers (CI/CD `ENV013` scope, remote required-key validation) | planned |
| `1.2` | systemd and Kubernetes deployment/runtime drift (`ENV012`), secret lifecycle (`ENV015`) | planned |
| `1.3+` | Signed metadata snapshots, optional dashboard & history | planned |

envcanary is local-first and useful without an account or hosted service.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md). Run `npm run lint && npm test && npm run build` before opening a PR.

## Third-Party Notices

envcanary ships **zero runtime dependencies** and bundles no third-party code, so there is no upstream code or data to attribute. The dotenv parser and the JS/TS scanner are original implementations. envcanary's behaviour follows public specifications and methodologies — [Twelve-Factor Config](https://12factor.net/config), [SARIF 2.1.0 (OASIS)](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), and [JSON Schema](https://json-schema.org/) — which are referenced as inspiration only, not redistributed. Development-only dependencies (TypeScript, Jest) are listed in `devDependencies` and are not part of the published package.

## Limitations

- **Static analysis has limits.** Computed/dynamic environment access cannot be fully resolved; envcanary reports it as `ENV014` / `UNKNOWN` rather than guessing.
- **Scope.** Docker/Compose and Next.js build-manifest drift (`ENV009`) ship today. Provider integrations (GitHub/GitLab/Vercel/Vault → `ENV013`), Kubernetes/systemd stale-runtime detection (`ENV012`), and secret lifecycle (`ENV015`) are declared in the taxonomy but land in later releases — see the [roadmap](#roadmap).
- **Adapter locations.** Docker/Compose findings currently point at the file (line `1`); precise line tracking through the YAML parser is a follow-up.
- **TypeScript configs are not loaded directly** (zero-dependency policy). Use a JS/JSON contract or compile first.
- **Not a secret manager.** envcanary detects drift; it never mutates production, rotates secrets, or exports values.

## License

MIT © 2026 Clear Wave Information Technologies (CWIT). See [LICENSE](./LICENSE).
