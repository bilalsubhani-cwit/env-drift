# Contributing to env-drift

Thanks for your interest in improving env-drift. This document explains how to
report issues, propose changes, and get a pull request merged.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Reporting Issues](#reporting-issues)
- [Proposing a Change](#proposing-a-change)
- [Development Setup](#development-setup)
- [Tests](#tests)
- [Adding a Rule or Adapter](#adding-a-rule-or-adapter)
- [Pull Request Checklist](#pull-request-checklist)
- [Security Disclosures](#security-disclosures)
- [License](#license)

## Code of Conduct

This project is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it. Please report unacceptable behaviour
through the channels listed there.

## Ways to Contribute

- **Bug reports** — a parser edge case, a scanner false positive/negative, a
  rule that misfires.
- **New value rules or framework adapters** — see the [roadmap](./readme.md#roadmap).
- **Documentation** — clarifications, examples, and corrections.
- **Test fixtures** — real-world `.env` files and code patterns that the
  scanner or parser should handle.

## Reporting Issues

Open a GitHub issue with:

- env-drift and Node.js versions.
- A **minimal** reproduction: the smallest contract, `.env` fixture, or source
  snippet that shows the problem.
- What you expected vs what happened.

**Never paste real secret values** into an issue. Redact them — env-drift is a
tool that helps you avoid exactly that.

## Proposing a Change

For anything beyond a small fix, open an issue first so we can agree on the
approach. Rule identifiers (`ENV001`…`ENV016`) and the JSON/SARIF output shape
are a **stability contract** — changes there need discussion because they break
downstream suppressions and dashboards.

## Development Setup

```bash
git clone https://github.com/cwit-ae/env-drift.git
cd env-drift
npm install            # dev dependencies only; runtime deps are zero
npm run lint           # tsc --noEmit
npm test               # jest
npm run build          # dual ESM + CJS + types
```

The package has **zero runtime dependencies** and that is a hard invariant. A
PR that adds a runtime dependency will not be merged unless it is removing far
more weight than it adds and has been discussed first. Parsers, scanners, and
arg handling are hand-rolled on purpose.

## Tests

- Tests live in [`tests/`](./tests) and run on Jest via `ts-jest`.
- Every bug fix should add a regression test.
- Security-sensitive code (redaction, the parser, the scanner) must keep its
  existing tests green and add coverage for the new path.
- A useful assertion for any finding-producing change:
  `expect(JSON.stringify(report)).not.toContain(secretValue)`.

## Adding a Rule or Adapter

1. Reserve or reuse a code in [`src/codes.ts`](./src/codes.ts) — do not
   repurpose an existing one.
2. Emit findings through the engine so suppression, severity resolution, and
   redaction apply uniformly. Never build a finding message by interpolating a
   raw value; use the helpers in [`src/engine/redact.ts`](./src/engine/redact.ts).
3. Add tests and update the [Drift Taxonomy](./readme.md#drift-taxonomy) table.

## Pull Request Checklist

- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds and `npm pack --dry-run` lists only `dist/`.
- [ ] No new runtime dependency.
- [ ] No secret value can reach stdout, a report, or an error message.
- [ ] New behaviour is covered by tests and noted in `CHANGELOG.md`.

## Security Disclosures

Do **not** open a public issue for a vulnerability — especially one where a
secret could leak. Follow [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
