import { spawn } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const distCliPath = path.join(repoRoot, 'dist', 'cli.js');
const runtimeDir = path.join(repoRoot, '.tmp', 'byo-llm');
const configSuffix = '.aegis.config.json';
const templatePattern = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

async function getProviders() {
  const entries = await readdir(__dirname, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(configSuffix))
    .map(entry => entry.name.slice(0, -configSuffix.length))
    .sort();
}

function collectPositionalArgs(args) {
  return args.filter(arg => !arg.startsWith('--'));
}

function resolveTemplateString(value, env, missing) {
  return value.replace(templatePattern, (_match, name, fallback) => {
    const envValue = env[name];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    missing.add(name);
    return '';
  });
}

function resolveTemplates(value, env, missing) {
  if (typeof value === 'string') {
    return resolveTemplateString(value, env, missing);
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveTemplates(item, env, missing));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, env, missing)]),
    );
  }
  return value;
}

function printUsage(providers) {
  console.log(`BYO LLM example runner

Usage:
  node examples/byo-llm/run-example.mjs --list
  node examples/byo-llm/run-example.mjs <provider> [--print-config] [-- <aegis args...>]

Providers:
  ${providers.join(', ')}
`);
}

async function main() {
  const args = process.argv.slice(2);
  const providers = await getProviders();

  if (args.includes('--help') || args.includes('-h')) {
    printUsage(providers);
    return;
  }

  if (args.includes('--list')) {
    console.log(providers.join('\n'));
    return;
  }

  const printConfig = args.includes('--print-config');
  const passthroughIndex = args.indexOf('--');
  const runnerArgs = passthroughIndex === -1 ? args : args.slice(0, passthroughIndex);
  const aegisArgs = passthroughIndex === -1 ? [] : args.slice(passthroughIndex + 1);
  const provider = collectPositionalArgs(runnerArgs)[0];

  if (!provider) {
    printUsage(providers);
    process.exit(1);
  }

  const templatePath = path.join(__dirname, `${provider}${configSuffix}`);
  try {
    await access(templatePath);
  } catch {
    console.error(`Unknown provider "${provider}". Available providers: ${providers.join(', ')}`);
    process.exit(1);
  }

  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  const missing = new Set();
  const resolved = resolveTemplates(template, process.env, missing);

  if (missing.size > 0) {
    console.error(
      `Missing required environment variables for ${provider}: ${Array.from(missing).sort().join(', ')}`,
    );
    process.exit(1);
  }

  if (printConfig) {
    console.log(JSON.stringify(resolved, null, 2));
    return;
  }

  try {
    await access(distCliPath);
  } catch {
    console.error('dist/cli.js is missing. Run "npm run build" first.');
    process.exit(1);
  }

  await mkdir(runtimeDir, { recursive: true });
  const runtimeConfigPath = path.join(runtimeDir, `${provider}.${process.pid}.aegis.config.json`);
  await writeFile(runtimeConfigPath, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(runtimeConfigPath, { force: true });
  };

  const child = spawn(process.execPath, [distCliPath, '--config', runtimeConfigPath, ...aegisArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  let exitCode = 0;
  try {
    const forwardSignal = (signal) => {
      if (!child.killed) {
        child.kill(signal);
      }
    };

    process.on('SIGINT', () => forwardSignal('SIGINT'));
    process.on('SIGTERM', () => forwardSignal('SIGTERM'));

    const exitResult = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    exitCode = exitResult && typeof exitResult === 'object' && exitResult.signal
      ? 1
      : exitResult && typeof exitResult === 'object'
        ? exitResult.code ?? 0
        : 0;
  } finally {
    await cleanup();
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
