#!/usr/bin/env node
/**
 * The env-drift CLI. Argument parsing is hand-rolled to preserve the package's
 * zero-runtime-dependency guarantee.
 *
 * Commands:
 *   env-drift init                         scaffold a starter contract
 *   env-drift scan                         scan code/files, no provider access
 *   env-drift check --env <name>           validate an environment vs the contract
 *   env-drift diff <a> <b>                  policy-aware comparison of two envs
 *   env-drift explain <VAR> --env <name>   show provenance & policy for one var
 *   env-drift generate <example|types|docs> emit an artifact from the contract
 *   env-drift doctor                       sanity-check the setup
 *
 * Exit codes: 0 ok · 1 policy violations · 2 invalid contract/parse · 4 unknown.
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';

import type { Contract, DriftReport, EnvironmentName, ParsedEnvFile, Finding } from './types.js';
import { loadContract, findContract, ContractLoadError } from './config/load-contract.js';
import { validateContract } from './contract/validate.js';
import { checkEnvironment } from './engine/drift.js';
import { diffEnvironments } from './engine/diff.js';
import { scanServices, checkServices } from './engine/services.js';
import { scanProjectCode, readEnvFile, discoverEnvFiles } from './scan/discover.js';
import { resolvePrecedence } from './scan/precedence.js';
import { parseDotenv, toEnvMap } from './parse/dotenv.js';
import { render, reportFromFindings, reportExitCode, type ReportFormat } from './report/index.js';
import { generateExample, generateTypes, generateDocs } from './generate/index.js';
import { discoverDocker, checkDocker } from './adapters/docker/index.js';
import { writeManifest, checkManifest, type BuildManifest } from './adapters/next/manifest.js';
import { CODES } from './codes.js';
import { maskValue } from './engine/redact.js';

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

/** Minimal flag parser: `--key value`, `--key=value`, `--bool`, positionals. */
function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          out.flags[key] = next;
          i++;
        } else {
          out.flags[key] = true;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function flagStr(args: Args, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = args.flags[n];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function out(s: string): void {
  process.stdout.write(s + '\n');
}
function err(s: string): void {
  process.stderr.write(s + '\n');
}

const USAGE = `env-drift — configuration drift detection

Usage:
  env-drift init                          Scaffold a starter contract
  env-drift scan [--format f]             Scan code & .env files against the contract
  env-drift check --env <name> [--file f] Validate an environment against the contract
  env-drift diff <envA> <envB>            Policy-aware comparison of two environments
  env-drift explain <VAR> --env <name>    Show provenance and policy for one variable
  env-drift generate <example|types|docs> Emit an artifact from the contract
  env-drift manifest write --env <name>   Write a build manifest (public-var fingerprints)
  env-drift manifest check --env <name>   Detect build/runtime drift (ENV009) vs a manifest
  env-drift doctor                        Sanity-check the project setup

Options:
  --config <path>   Path to the contract (default: search cwd)
  --env <name>      Target environment
  --service <name>  Limit scan to one declared service root (monorepo)
  --file <path>     A specific .env file to read values from
  --format <f>      Output format: terminal | json | sarif (default: terminal)
  --no-color        Disable ANSI colour
  -h, --help        Show this help
  -v, --version     Show version`;

/** Reads the package version from the installed package.json. */
function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Loads & structurally validates the contract, or exits with code 2. */
async function getContract(args: Args): Promise<{ contract: Contract; file: string }> {
  const configPath = flagStr(args, 'config') ?? process.cwd();
  let loaded;
  try {
    loaded = await loadContract(configPath);
  } catch (e) {
    err(`error: ${(e as Error).message}`);
    process.exit(2);
  }
  const errors = validateContract(loaded.contract);
  if (errors.length) {
    err('error: contract is invalid:');
    for (const ce of errors) err(`  - ${ce.path}: ${ce.message}`);
    process.exit(2);
  }
  return loaded;
}

function getFormat(args: Args): ReportFormat {
  const f = flagStr(args, 'format');
  if (f === 'json' || f === 'sarif' || f === 'terminal') return f;
  return 'terminal';
}

function emit(report: DriftReport, format: ReportFormat): void {
  out(render(report, format));
}

// --- commands ---------------------------------------------------------------

const STARTER = `// env-drift contract — see https://github.com/cwit-ae/env-drift
const { defineConfig, variable } = require('env-drift');

module.exports = defineConfig({
  contractVersion: 1,
  environments: ['local', 'ci', 'staging', 'production'],
  variables: {
    NODE_ENV: variable.enum({
      values: ['development', 'test', 'production'],
      requiredIn: ['local', 'ci', 'staging', 'production'],
    }),
    PORT: variable.port({ default: 3000 }),
    DATABASE_URL: variable.url({
      requiredIn: ['ci', 'staging', 'production'],
      secret: true,
      rules: { production: { forbiddenHosts: ['localhost', '127.0.0.1'] } },
    }),
    DEBUG: variable.boolean({
      default: false,
      rules: { production: { allowedValues: [false] } },
    }),
  },
});
`;

function cmdInit(args: Args): number {
  const target = resolve(process.cwd(), 'env-drift.config.js');
  if (existsSync(target) || findContract(process.cwd())) {
    err('error: a contract already exists in this directory.');
    return 2;
  }
  writeFileSync(target, STARTER, 'utf8');
  out(`Created ${basename(target)}. Edit it, then run \`env-drift scan\`.`);
  return 0;
}

async function cmdScan(args: Args): Promise<number> {
  const { contract } = await getContract(args);
  const cwd = flagStr(args, 'root') ?? process.cwd();

  // `--service <name>` narrows the scan to one declared service's root.
  const service = flagStr(args, 'service');
  if (service && !contract.services?.[service]) {
    err(`error: "${service}" is not a declared service in the contract.`);
    return 2;
  }
  const root = service ? join(cwd, contract.services![service].root) : cwd;

  const references = scanProjectCode(root);

  // Resolve effective values with full .env precedence so ENV006 (shadowing)
  // and provenance are accurate, and pass the parsed files for ENV005.
  const envFiles = discoverEnvFiles(root);
  const env = flagStr(args, 'env') ?? contract.environments[0];
  const { values } = resolvePrecedence(envFiles, env);

  // Docker / Compose adapter: discover image-build env and flag baked secrets.
  const extraFindings: Finding[] = checkDocker(discoverDocker(root), contract);

  // Monorepo: cross-service consumer/producer drift (whole-repo scans only).
  if (!service && contract.services) {
    extraFindings.push(...checkServices(contract, scanServices(contract, cwd)));
  }

  const report = checkEnvironment({
    contract,
    environment: env,
    values,
    references,
    files: envFiles,
    extraFindings,
    now: new Date(),
  });
  emit(report, getFormat(args));
  return reportExitCode(report);
}

async function cmdCheck(args: Args): Promise<number> {
  const { contract } = await getContract(args);
  const env = flagStr(args, 'env');
  if (!env) {
    err('error: --env <name> is required for check.');
    return 2;
  }

  const file = flagStr(args, 'file');
  let values: Record<string, string>;
  let files: ParsedEnvFile[] | undefined;
  if (file) {
    const parsed = readEnvFile(resolve(file));
    if (!parsed) {
      err(`error: could not read env file "${file}".`);
      return 2;
    }
    values = toEnvMap(parsed);
    files = [parsed]; // enables ENV005 duplicate detection for this file
  } else {
    values = process.env as Record<string, string>;
    files = undefined;
  }

  // When reading the live process environment, do not enumerate its (often
  // sensitive) undeclared key names into the report.
  const report = checkEnvironment({
    contract,
    environment: env,
    values,
    files,
    reportUndeclared: !!file,
    now: new Date(),
  });
  emit(report, getFormat(args));
  return reportExitCode(report);
}

async function cmdDiff(args: Args): Promise<number> {
  const { contract } = await getContract(args);
  const [, a, b] = args._;
  if (!a || !b) {
    err('error: usage: env-drift diff <envA> <envB> [--fileA f] [--fileB f]');
    return 2;
  }
  const fileA = flagStr(args, 'fileA');
  const fileB = flagStr(args, 'fileB');
  const valuesA = fileA ? toEnvMap(parseDotenv(readFileSync(resolve(fileA), 'utf8'), fileA)) : {};
  const valuesB = fileB ? toEnvMap(parseDotenv(readFileSync(resolve(fileB), 'utf8'), fileB)) : {};

  const findings = diffEnvironments(contract, a, valuesA, b, valuesB);
  const report = reportFromFindings(findings);
  emit(report, getFormat(args));
  return reportExitCode(report);
}

async function cmdManifest(args: Args): Promise<number> {
  const sub = args._[1];
  const { contract } = await getContract(args);
  const env = flagStr(args, 'env');
  if (!env) {
    err('error: --env <name> is required for manifest.');
    return 2;
  }

  // Resolve the values this build/deploy sees.
  const file = flagStr(args, 'file');
  const values: Record<string, string> = file
    ? toEnvMap(parseDotenv(readFileSync(resolve(file), 'utf8'), file))
    : (process.env as Record<string, string>);

  if (sub === 'write') {
    const buildId =
      flagStr(args, 'build-id') ?? process.env.BUILD_ID ?? process.env.GITHUB_SHA ?? 'unknown';
    const manifest = writeManifest({ contract, environment: env, values, buildId });
    const text = JSON.stringify(manifest, null, 2);
    const outFile = flagStr(args, 'out');
    if (outFile) {
      writeFileSync(resolve(outFile), text, 'utf8');
      out(`Wrote ${outFile}`);
    } else {
      out(text);
    }
    return 0;
  }

  if (sub === 'check') {
    const manifestPath = flagStr(args, 'manifest');
    if (!manifestPath) {
      err('error: --manifest <path> is required for manifest check.');
      return 2;
    }
    let manifest: BuildManifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8')) as BuildManifest;
    } catch (e) {
      err(`error: could not read manifest: ${(e as Error).message}`);
      return 2;
    }
    const findings = checkManifest({ manifest, contract, environment: env, values });
    const report = reportFromFindings(findings, env);
    emit(report, getFormat(args));
    return reportExitCode(report);
  }

  err('error: usage: env-drift manifest <write|check> --env <name> [...]');
  return 2;
}

async function cmdExplain(args: Args): Promise<number> {
  const { contract, file } = await getContract(args);
  const name = args._[1];
  if (!name) {
    err('error: usage: env-drift explain <VAR> --env <name>');
    return 2;
  }
  const def = contract.variables[name];
  if (!def) {
    err(`error: "${name}" is not declared in the contract.`);
    return 2;
  }
  const env = flagStr(args, 'env') ?? contract.environments[0];

  out(`${name} — ${env}`);
  out('');
  out('Contract:');
  out(`  Type:      ${def.type}`);
  out(`  Required:  ${def.requiredIn?.includes(env) ? 'yes' : 'no'}`);
  out(`  Secret:    ${def.secret ? 'yes' : 'no'}`);
  out(`  Exposure:  ${def.exposure ?? '—'}`);
  out(`  Phase:     ${def.phase ?? '—'}`);
  out(`  Owner:     ${def.owner ?? '—'}`);
  if (def.consumers?.length) out(`  Consumers: ${def.consumers.join(', ')}`);
  if (def.producers?.length) out(`  Producers: ${def.producers.join(', ')}`);
  if (def.description) out(`  About:     ${def.description}`);
  out('');

  // Provenance: which discovered .env files define this key.
  out('Definitions discovered:');
  const envFiles = discoverEnvFiles(process.cwd());
  let found = false;
  for (const f of envFiles) {
    const entry = [...f.entries].reverse().find((e) => e.key === name);
    if (entry) {
      found = true;
      const shown = maskValue(entry.value, { secret: !!def.secret });
      out(`  ${f.file}: ${shown}`);
    }
  }
  if (!found) out('  (none found in local .env files)');
  out('');
  out(`Contract file: ${file}`);
  return 0;
}

async function cmdGenerate(args: Args): Promise<number> {
  const { contract } = await getContract(args);
  const what = args._[1];
  let text: string;
  if (what === 'example') text = generateExample(contract);
  else if (what === 'types') text = generateTypes(contract);
  else if (what === 'docs') text = generateDocs(contract);
  else {
    err('error: usage: env-drift generate <example|types|docs> [--out file]');
    return 2;
  }
  const outFile = flagStr(args, 'out');
  if (outFile) {
    writeFileSync(resolve(outFile), text, 'utf8');
    out(`Wrote ${outFile}`);
  } else {
    out(text);
  }
  return 0;
}

async function cmdDoctor(args: Args): Promise<number> {
  const contractFile = findContract(process.cwd());
  out('env-drift doctor');
  out('');
  out(`  contract:        ${contractFile ?? 'NOT FOUND (run `env-drift init`)'}`);
  if (contractFile) {
    try {
      const { contract } = await loadContract(contractFile);
      const errors = validateContract(contract);
      out(`  contract valid:  ${errors.length === 0 ? 'yes' : `no (${errors.length} issue(s))`}`);
      out(`  variables:       ${Object.keys(contract.variables).length}`);
      out(`  environments:    ${contract.environments.join(', ')}`);
    } catch (e) {
      out(`  contract valid:  no — ${(e as Error).message}`);
    }
  }
  const envFiles = discoverEnvFiles(process.cwd());
  out(`  .env files:      ${envFiles.length}`);
  out(`  rules available: ${Object.keys(CODES).length} (ENV001–ENV016)`);
  out('');
  out('  Tip: env-drift never prints secret values. --format json/sarif for CI.');
  return 0;
}

// --- entry ------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.flags.version || args.flags.v) {
    out(version());
    process.exit(0);
  }
  if (args.flags.help || args.flags.h || args._.length === 0) {
    out(USAGE);
    process.exit(0);
  }
  // `--no-color` arrives as flags.color === false via the parser? Normalize:
  if (args.flags['no-color']) process.env.NO_COLOR = '1';

  const command = args._[0];
  let code = 0;
  switch (command) {
    case 'init':
      code = cmdInit(args);
      break;
    case 'scan':
      code = await cmdScan(args);
      break;
    case 'check':
      code = await cmdCheck(args);
      break;
    case 'diff':
      code = await cmdDiff(args);
      break;
    case 'explain':
      code = await cmdExplain(args);
      break;
    case 'generate':
      code = await cmdGenerate(args);
      break;
    case 'manifest':
      code = await cmdManifest(args);
      break;
    case 'doctor':
      code = await cmdDoctor(args);
      break;
    default:
      err(`error: unknown command "${command}"\n`);
      out(USAGE);
      code = 2;
  }
  process.exit(code);
}

main().catch((e) => {
  err(`error: ${(e as Error).message}`);
  process.exit(2);
});
