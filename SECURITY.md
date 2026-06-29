# Security Policy

## Supported Versions

env-drift is pre-1.0 and on a single active minor line. We provide security
updates for the latest published release on the `0.x` line. Once `1.0` ships,
this table will move to the latest `1.x` minor.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

If you are running an older version, please upgrade to the latest release
before opening a security report — the issue may already be resolved.

## Why this package takes security seriously

env-drift inspects environment variables, `.env` files, and (optionally,
through read-only providers) deployment configuration. That means it routinely
sits next to **secret material**. The package is designed so that secrets are
redacted by default and never written to snapshots, reports, or CI artifacts.
A vulnerability that causes env-drift to **leak a secret value** — into stdout,
a JSON/SARIF report, a snapshot, or an error message — is treated as the
highest-severity class of bug.

## Reporting a Vulnerability

**Please do not file public issues for security vulnerabilities.** Public
issues are indexed by search engines and notify every repository watcher,
which can give an attacker time to exploit the issue before users have updated.

Use one of the following private channels instead:

1. **Preferred — GitHub Security Advisories:** open a draft advisory at
   <https://github.com/cwit-ae/env-drift/security/advisories/new>. Only the
   maintainers see the report. GitHub provides a private fork for coordinated
   patch development.
2. Email the maintainers privately. Refer to the maintainer contact listed on
   the [npm page for `env-drift`](https://www.npmjs.com/package/env-drift).

When you submit a report, please include — as much as is practical:

- A clear description of the issue and the impact you believe it has.
- Steps to reproduce, including a minimal contract, `.env` fixture, and the
  exact `env-drift` + Node.js versions.
- A minimal proof-of-concept (a few lines of TypeScript or JavaScript, or a
  single CLI invocation).
- Whether you have disclosed the issue elsewhere, and if so, where.

## Scope

The following are in scope and welcomed as security reports:

- Any path that causes a value classified as a **secret** to appear in
  cleartext in stdout, a report (`terminal` / `json` / `sarif`), a snapshot,
  an exit message, or a generated artifact (`.env.example`, types, docs).
- Inputs (a contract, `.env` file, or source file) that cause the parser,
  scanner, or engine to crash, throw an uncaught error, or hang
  (catastrophic backtracking, allocation amplification, pathological input).
- A provider failure being reported as **`PASS` / no drift** instead of
  `UNKNOWN`, which could mask a real misconfiguration.
- Path-traversal or arbitrary-file-read triggered by a crafted contract,
  glob, or source-discovery path.
- Any vulnerability in the published package's build output (`dist/`) that
  does not exist in the source.

The following are **out of scope** and should be filed as ordinary GitHub
issues using the standard templates instead:

- A missing framework or platform adapter (a discovery source we do not yet
  support).
- False positives or false negatives in drift detection on benign input.
- Issues in transitive dependencies of consumers (env-drift itself ships zero
  runtime dependencies).

## Disclosure Process

Once a report is submitted:

1. We aim to **acknowledge receipt within five business days**.
2. We work with the reporter to confirm the issue and agree on a remediation
   plan.
3. A fix is developed and tested in a private branch. For fixes that touch the
   parser, scanner, redaction, or reporting layers, we run the full Jest suite
   and the redaction regression tests before release.
4. A patched version is published to npm. The release notes credit the
   reporter (with their permission) and link to the advisory.
5. The advisory is published publicly once users have had a reasonable window
   to upgrade.

We do not currently operate a paid bug-bounty programme. Reporters are credited
in the release notes and the published advisory unless they prefer to remain
anonymous.

## Coordinated Disclosure Expectations

We ask that reporters give us a reasonable opportunity to remediate before any
public disclosure — typically 90 days from acknowledgement, shorter for clearly
low-risk issues, longer if the fix requires substantial rework. If you intend
to disclose publicly, please tell us in advance so the release and advisory can
be coordinated with your timeline.

Thank you for helping keep env-drift and its users safe.
