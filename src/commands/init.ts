/**
 * commands/init.ts — Interactive project bootstrap (`ag init`).
 *
 * Detects tmux, scaffolds `.aegis/config.yaml`, generates API keys,
 * creates the state directory, and prints next steps.
 * Also handles `--list-templates` and `--from-template`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { getConfiguredBaseUrl, getDashboardUrl, normalizeBaseUrl } from '../base-url.js';
import { loadConfig, readConfigFile, serializeConfigFile, writeConfigFile, type Config } from '../config.js';
import { AuthManager } from '../services/auth/index.js';
import { buildEnvSchema, ENV_BYO_LLM_WHITELIST, getErrorMessage } from '../validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BYO_ENV_FIELDS = [
  { key: 'ANTHROPIC_BASE_URL', label: 'ANTHROPIC base URL' },
  { key: 'ANTHROPIC_AUTH_TOKEN', label: 'ANTHROPIC auth token' },
  { key: 'ANTHROPIC_DEFAULT_MODEL', label: 'ANTHROPIC default model' },
  { key: 'ANTHROPIC_DEFAULT_FAST_MODEL', label: 'ANTHROPIC fast model' },
  { key: 'API_TIMEOUT_MS', label: 'API timeout (ms)' },
] as const;

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

interface InitSummary {
  authToken: string;
  baseUrl: string;
  commandPrefix: string;
  configPath: string;
  dashboardEnabled: boolean;
  tokenCreated: boolean;
  wroteConfig: boolean;
}

type TemplateType = 'agent' | 'skill' | 'slash-command';

interface TemplateManifestEntry {
  name: string;
  type: TemplateType;
  summary: string;
  scaffoldRoot: string;
  targets: string[];
}

export interface StarterTemplateCheckFile {
  displayPath: string;
  targetPath: string;
  templateName: string;
}

interface TemplateScaffoldOperation {
  displayPath: string;
  sourcePath: string;
  targetPath: string;
}

interface Prompter {
  close(): void;
  question(prompt: string): Promise<string>;
}

// --- Shared utilities ---

function write(stream: NodeJS.WritableStream, text: string): void {
  stream.write(text);
}

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

function checkDependency(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { /* command not found or exited non-zero */
    return false;
  }
}

function checkTmuxVersion(minMajor: number = 3, minMinor: number = 2): { ok: boolean; version: string | null } {
  try {
    const out = execFileSync('tmux', ['-V'], { encoding: 'utf-8', timeout: 5000 }).trim();
    const m = out.match(/tmux\s+(\d+)\.(\d+)/i);
    if (!m) return { ok: false, version: null };
    const major = parseInt(m[1]!, 10);
    const minor = parseInt(m[2]!, 10);
    const ok = major > minMajor || (major === minMajor && minor >= minMinor);
    return { ok, version: `${major}.${minor}` };
  } catch {
    return { ok: false, version: null };
  }
}

// --- Config path helpers ---

function defaultInitConfigPath(): string {
  return join(process.cwd(), '.aegis', 'config.yaml');
}

function getOptionValue(args: string[], option: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === option) {
      return index + 1 < args.length ? args[index + 1]! : '';
    }
    const prefix = `${option}=`;
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }
  return null;
}

function resolveInitConfigPath(args: string[]): string {
  const configPath = getOptionValue(args, '--config');
  if (configPath) {
    return resolve(configPath);
  }
  return defaultInitConfigPath();
}

function formatConfigPath(configPath: string): string {
  const relativePath = relative(process.cwd(), configPath);
  if (!relativePath || relativePath.startsWith('..')) {
    return configPath;
  }
  return relativePath;
}

function commandPrefixForConfig(configPath: string): string {
  if (configPath === defaultInitConfigPath()) {
    return 'ag';
  }
  return `ag --config "${configPath}"`;
}

// --- Template gallery ---

function templateGalleryRoot(): string {
  return join(__dirname, '../../templates');
}

function normalizeTemplatePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function renderTemplatePath(relativePath: string): string {
  return normalizeTemplatePath(relativePath).replace(/\//g, sep);
}

function resolveTemplateRelativePath(baseDir: string, relativePath: string): string {
  return join(baseDir, ...normalizeTemplatePath(relativePath).split('/').filter(Boolean));
}

function isTemplateType(value: unknown): value is TemplateType {
  return value === 'agent' || value === 'skill' || value === 'slash-command';
}

function isTemplateTargets(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTemplateManifest(raw: unknown): TemplateManifestEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error('Template manifest must be an array.');
  }

  return raw.map((entry, index) => {
    if (!isObjectRecord(entry)) {
      throw new Error(`Template manifest entry ${index + 1} must be an object.`);
    }

    const { name, type, summary, scaffoldRoot, targets } = entry;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Template manifest entry ${index + 1} is missing a valid name.`);
    }
    if (!isTemplateType(type)) {
      throw new Error(`Template ${name} has an invalid type.`);
    }
    if (typeof summary !== 'string' || summary.length === 0) {
      throw new Error(`Template ${name} is missing a summary.`);
    }
    if (typeof scaffoldRoot !== 'string' || scaffoldRoot.length === 0) {
      throw new Error(`Template ${name} is missing a scaffoldRoot.`);
    }
    if (!isTemplateTargets(targets)) {
      throw new Error(`Template ${name} is missing target file paths.`);
    }

    return { name, type, summary, scaffoldRoot, targets };
  });
}

async function loadTemplateGallery(): Promise<TemplateManifestEntry[]> {
  const manifestPath = join(templateGalleryRoot(), 'manifest.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to read template manifest: ${getErrorMessage(error)}`);
  }
  return parseTemplateManifest(parsed);
}

async function collectRelativeFiles(rootPath: string, prefix: string = ''): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectRelativeFiles(entryPath, relativePath));
      continue;
    }
    files.push(normalizeTemplatePath(relativePath));
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(entry => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function getTemplateScaffoldOperations(
  template: TemplateManifestEntry,
  targetRoot: string,
): Promise<TemplateScaffoldOperation[]> {
  const scaffoldRoot = resolveTemplateRelativePath(templateGalleryRoot(), template.scaffoldRoot);
  const availableFiles = await collectRelativeFiles(scaffoldRoot);
  const expectedFiles = template.targets
    .map((targetPath) => normalizeTemplatePath(targetPath))
    .sort((left, right) => left.localeCompare(right));

  if (stableStringify(availableFiles) !== stableStringify(expectedFiles)) {
    throw new Error(`Template ${template.name} manifest does not match scaffold files.`);
  }

  return expectedFiles.map((targetPath) => ({
    displayPath: renderTemplatePath(targetPath),
    sourcePath: resolveTemplateRelativePath(scaffoldRoot, targetPath),
    targetPath: resolveTemplateRelativePath(targetRoot, targetPath),
  }));
}

function hasTemplateDescription(content: string): boolean {
  return /^---[\s\S]*?description:\s*.+?[\s\S]*?---/m.test(content);
}

function hasTemplateHeading(content: string): boolean {
  return /^#\s+\S/m.test(content);
}

function hasTemplateCustomizationGuide(content: string): boolean {
  return /##\s+Customi[sz]e This Template/i.test(content);
}

// --- Init helpers ---

function validateBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must use http:// or https://');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Base URL must not include a path, query string, or hash');
  }
  return normalizeBaseUrl(input);
}

function filterByoEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const allowed = new Set<string>(ENV_BYO_LLM_WHITELIST);
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => allowed.has(key)),
  );
}

function resolveExistingToken(config: Partial<Config> | null): string {
  if (!config) return '';
  return config.clientAuthToken || config.authToken || '';
}

function buildInitComparisonConfig(
  config: Partial<Config>,
  hasGeneratedToken: boolean,
): Partial<Config> {
  if (!hasGeneratedToken) {
    return config;
  }
  return { ...config, clientAuthToken: '__generated__' };
}

function formatPromptDefault(defaultValue: string): string {
  return defaultValue ? ` [${defaultValue}]` : '';
}

// --- Prompt utilities ---

async function readBufferedInput(input: NodeJS.ReadableStream): Promise<string[]> {
  let text = '';
  for await (const chunk of input) {
    text += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  }
  return text.split(/\r?\n/);
}

function createPrompter(io: CliIO): Prompter {
  if ('isTTY' in io.stdin && io.stdin.isTTY) {
    const rl = createInterface({
      input: io.stdin,
      output: io.stdout,
      terminal: true,
    });
    return {
      close: () => rl.close(),
      question: (prompt) => rl.question(prompt),
    };
  }

  const bufferedLinesPromise = readBufferedInput(io.stdin);
  let index = 0;
  return {
    close: () => {},
    async question(prompt: string): Promise<string> {
      write(io.stdout, prompt);
      const lines = await bufferedLinesPromise;
      const answer = lines[index] ?? '';
      index += 1;
      return answer;
    },
  };
}

async function promptLine(prompter: Prompter, label: string, defaultValue: string = ''): Promise<string> {
  const answer = await prompter.question(`${label}${formatPromptDefault(defaultValue)}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

async function promptBoolean(
  prompter: Prompter,
  io: CliIO,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  for (;;) {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = (await prompter.question(`${label} ${suffix}: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    writeLine(io.stderr, '  ❌ Please answer y or n.');
  }
}

async function promptBaseUrl(
  prompter: Prompter,
  io: CliIO,
  defaultValue: string,
): Promise<string> {
  for (;;) {
    const answer = await promptLine(prompter, 'Base URL', defaultValue);
    try {
      return validateBaseUrl(answer);
    } catch (error) {
      writeLine(io.stderr, `  ❌ ${getErrorMessage(error)}`);
    }
  }
}

async function promptByoEnv(
  prompter: Prompter,
  io: CliIO,
  existingByoEnv: Record<string, string>,
): Promise<Record<string, string> | undefined> {
  const shouldConfigure = await promptBoolean(
    prompter,
    io,
    'Configure optional BYO-LLM defaults for every session?',
    Object.keys(existingByoEnv).length > 0,
  );
  if (!shouldConfigure) {
    return undefined;
  }

  const nextEnv: Record<string, string> = { ...existingByoEnv };
  for (const field of BYO_ENV_FIELDS) {
    for (;;) {
      const answer = await promptLine(prompter, `  ${field.label}`, existingByoEnv[field.key] ?? '');
      if (field.key === 'API_TIMEOUT_MS' && answer && !/^[1-9]\d*$/.test(answer)) {
        writeLine(io.stderr, '  ❌ API timeout must be a positive integer.');
        continue;
      }
      if (answer) {
        nextEnv[field.key] = answer;
      } else {
        delete nextEnv[field.key];
      }
      break;
    }
  }

  const parsed = buildEnvSchema().safeParse(nextEnv);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => issue.message).join('; '));
  }
  return parsed.data;
}

// --- Init output ---

function printInitSummary(io: CliIO, summary: InitSummary): void {
  writeLine(io.stdout);
  writeLine(io.stdout, summary.wroteConfig
    ? `  ✅ Wrote ${summary.configPath}`
    : `  ✅ Using existing ${summary.configPath}`);
  writeLine(io.stdout, summary.tokenCreated
    ? '  ✅ Created admin API token'
    : summary.authToken
      ? '  ✅ Reusing existing API token'
      : '  ⚠️  No API token configured');
  writeLine(io.stdout);
  writeLine(io.stdout, '  Next steps:');
  writeLine(io.stdout, `    Start:      ${summary.commandPrefix}`);
  if (summary.dashboardEnabled) {
    writeLine(io.stdout, `    Dashboard:  ${getDashboardUrl(summary.baseUrl)}`);
  } else {
    writeLine(io.stdout, '    Dashboard:  disabled in config');
  }
  if (summary.authToken) {
    writeLine(io.stdout, `    API token:  ${summary.authToken}`);
  } else {
    writeLine(io.stdout, '    API token:  set AEGIS_AUTH_TOKEN or re-run ag init to create one');
  }
  writeLine(io.stdout, `    Session:    ${summary.commandPrefix} create "Describe your first task" --cwd .`);
}

// --- Template sub-commands ---

async function printTemplateList(io: CliIO): Promise<number> {
  const templates = await loadTemplateGallery();
  writeLine(io.stdout, '  Available templates:');
  for (const template of templates) {
    writeLine(io.stdout, `    - ${template.name} [${template.type}]`);
    writeLine(io.stdout, `      ${template.summary}`);
    writeLine(io.stdout, `      Files: ${template.targets.map(renderTemplatePath).join(', ')}`);
  }
  writeLine(io.stdout);
  writeLine(io.stdout, '  Scaffold one with: ag init --from-template <name>');
  return 0;
}

async function handleTemplateInit(templateName: string, args: string[], io: CliIO): Promise<number> {
  const yes = args.includes('--yes') || args.includes('-y');

  try {
    const templates = await loadTemplateGallery();
    const template = templates.find((entry) => entry.name === templateName);
    if (!template) {
      writeLine(io.stderr, `  ❌ Unknown template: ${templateName}`);
      writeLine(io.stderr, `     Available templates: ${templates.map((entry) => entry.name).join(', ')}`);
      return 1;
    }

    const operations = await getTemplateScaffoldOperations(template, process.cwd());
    const collisions = operations.filter((operation) => existsSync(operation.targetPath));

    if (collisions.length > 0) {
      if (yes) {
        writeLine(io.stdout, `  ℹ️  Left template ${template.name} unchanged because --yes never overwrites existing files.`);
        writeLine(io.stdout, `     Existing files: ${collisions.map((operation) => operation.displayPath).join(', ')}`);
        return 0;
      }

      const prompter = createPrompter(io);
      try {
        const overwrite = await promptBoolean(
          prompter,
          io,
          `Overwrite ${collisions.length} existing file(s) for template ${template.name}?`,
          false,
        );
        if (!overwrite) {
          writeLine(io.stdout, `  ℹ️  Left template ${template.name} unchanged.`);
          return 0;
        }
      } finally {
        prompter.close();
      }
    }

    for (const operation of operations) {
      await mkdir(dirname(operation.targetPath), { recursive: true });
      await copyFile(operation.sourcePath, operation.targetPath);
    }

    writeLine(io.stdout, `  ✅ Scaffolded ${template.type} template: ${template.name}`);
    writeLine(io.stdout, `     Files: ${operations.map((operation) => operation.displayPath).join(', ')}`);
    writeLine(io.stdout, '  Next steps:');
    writeLine(io.stdout, '    1. Open the generated file and replace the placeholders/checklists.');
    writeLine(io.stdout, '    2. Tune commands, tools, and wording for your repo.');
    writeLine(io.stdout, '    3. Run: ag doctor');
    return 0;
  } catch (error) {
    writeLine(io.stderr, `  ❌ Failed to scaffold template ${templateName}: ${getErrorMessage(error)}`);
    return 1;
  }
}

// --- Main init handler (exported) ---

export async function handleInit(args: string[], io: CliIO): Promise<number> {
  const templateName = getOptionValue(args, '--from-template');
  const shouldListTemplates = args.includes('--list-templates');

  if (shouldListTemplates && templateName !== null) {
    writeLine(io.stderr, '  ❌ Choose either --list-templates or --from-template, not both.');
    return 1;
  }

  if (shouldListTemplates) {
    try {
      return await printTemplateList(io);
    } catch (error) {
      writeLine(io.stderr, `  ❌ Failed to list templates: ${getErrorMessage(error)}`);
      return 1;
    }
  }

  if (templateName !== null) {
    if (templateName === '') {
      writeLine(io.stderr, '  ❌ Missing template name. Usage: ag init --from-template <name>');
      return 1;
    }
    return handleTemplateInit(templateName, args, io);
  }

  // --- Config bootstrap path ---

  const yes = args.includes('--yes') || args.includes('-y');
  const configPath = resolveInitConfigPath(args);
  const displayConfigPath = formatConfigPath(configPath);
  const commandPrefix = commandPrefixForConfig(configPath);
  const existingConfigText = existsSync(configPath)
    ? await readFile(configPath, 'utf-8').catch(() => null)
    : null;
  const existingConfig = await readConfigFile(configPath);
  const existingToken = resolveExistingToken(existingConfig);
  const existingByoEnv = filterByoEnv(existingConfig?.defaultSessionEnv);
  const currentConfig = await loadConfig();

  // Detect tmux
  const hasTmux = checkDependency('tmux', ['-V']);
  const tmuxCheck = hasTmux ? checkTmuxVersion(3, 2) : { ok: false, version: null };
  if (!hasTmux) {
    writeLine(io.stdout, '  ⚠️  tmux not found — sessions will not start without it.');
    writeLine(io.stdout, '     Install: sudo apt install tmux | brew install tmux');
  } else if (!tmuxCheck.ok) {
    writeLine(io.stdout, `  ⚠️  tmux ${tmuxCheck.version ?? 'unknown'} — Aegis requires 3.2+.`);
  } else {
    writeLine(io.stdout, `  ✅ tmux ${tmuxCheck.version} detected`);
  }

  // Ensure state directory exists
  const stateDir = currentConfig.stateDir;
  await mkdir(stateDir, { recursive: true });
  writeLine(io.stdout, `  ✅ State directory: ${stateDir}`);

  if (existingConfigText !== null && existingConfig === null && yes) {
    writeLine(
      io.stderr,
      `  ❌ ${displayConfigPath} already exists but could not be parsed. Re-run without --yes to confirm overwrite.`,
    );
    return 1;
  }

  let createAdminToken = !existingToken;
  let baseUrl = existingConfig?.baseUrl
    ? normalizeBaseUrl(existingConfig.baseUrl)
    : getConfiguredBaseUrl(currentConfig);
  let byoEnv: Record<string, string> | undefined;
  let dashboardEnabled = existingConfig?.dashboardEnabled ?? true;

  if (!yes) {
    const prompter = createPrompter(io);

    try {
      writeLine(io.stdout, `  Bootstrap config: ${displayConfigPath}`);
      writeLine(io.stdout);
      createAdminToken = await promptBoolean(
        prompter,
        io,
        existingToken
          ? 'Create a fresh admin API token for dashboard + CLI access?'
          : 'Create an admin API token for dashboard + CLI access?',
        !existingToken,
      );
      baseUrl = await promptBaseUrl(prompter, io, baseUrl);
      byoEnv = await promptByoEnv(prompter, io, existingByoEnv);
      dashboardEnabled = await promptBoolean(prompter, io, 'Enable the bundled dashboard?', dashboardEnabled);
    } finally {
      prompter.close();
    }
  }

  const nextConfig: Partial<Config> = { ...(existingConfig ?? {}) };
  nextConfig.baseUrl = baseUrl;
  nextConfig.dashboardEnabled = dashboardEnabled;

  if (byoEnv) {
    nextConfig.defaultSessionEnv = {
      ...(existingConfig?.defaultSessionEnv ?? {}),
      ...byoEnv,
    };
  }

  if (!nextConfig.defaultSessionEnv || Object.keys(nextConfig.defaultSessionEnv).length === 0) {
    delete nextConfig.defaultSessionEnv;
  }

  const generatedTokenRequested = createAdminToken;
  const desiredComparison = stableStringify(
    buildInitComparisonConfig(nextConfig, generatedTokenRequested),
  );
  const existingComparison = existingConfig
    ? stableStringify(existingConfig)
    : '';
  const needsWrite = existingConfigText === null || existingConfig === null || desiredComparison !== existingComparison;

  if (existingConfigText !== null && needsWrite) {
    if (yes) {
      writeLine(io.stdout, `  ℹ️  Left ${displayConfigPath} unchanged because --yes never overwrites existing files.`);
      printInitSummary(io, {
        authToken: existingToken,
        baseUrl: existingConfig?.baseUrl ? normalizeBaseUrl(existingConfig.baseUrl) : baseUrl,
        commandPrefix,
        configPath: displayConfigPath,
        dashboardEnabled: existingConfig?.dashboardEnabled ?? dashboardEnabled,
        tokenCreated: false,
        wroteConfig: false,
      });
      return 0;
    }

    const prompter = createPrompter(io);
    try {
      const overwrite = await promptBoolean(prompter, io, `Overwrite ${displayConfigPath}?`, false);
      if (!overwrite) {
        if (!existingConfig) {
          writeLine(io.stderr, `  ❌ Existing ${displayConfigPath} was left unchanged and is still invalid.`);
          return 1;
        }
        printInitSummary(io, {
          authToken: existingToken,
          baseUrl: existingConfig.baseUrl ? normalizeBaseUrl(existingConfig.baseUrl) : baseUrl,
          commandPrefix,
          configPath: displayConfigPath,
          dashboardEnabled: existingConfig.dashboardEnabled ?? dashboardEnabled,
          tokenCreated: false,
          wroteConfig: false,
        });
        return 0;
      }
    } finally {
      prompter.close();
    }
  }

  if (!needsWrite && !generatedTokenRequested) {
    printInitSummary(io, {
      authToken: existingToken,
      baseUrl,
      commandPrefix,
      configPath: displayConfigPath,
      dashboardEnabled,
      tokenCreated: false,
      wroteConfig: false,
    });
    return 0;
  }

  let authToken = existingToken;
  let tokenCreated = false;
  let createdKeyId: string | null = null;
  const authManager = new AuthManager(join(currentConfig.stateDir, 'keys.json'), currentConfig.authToken);
  await authManager.load();

  if (generatedTokenRequested) {
    const createdKey = await authManager.createKey('ag-init-admin', 100, undefined, 'admin');
    authToken = createdKey.key;
    createdKeyId = createdKey.id;
    nextConfig.clientAuthToken = createdKey.key;
    tokenCreated = true;
  }

  const finalConfigText = serializeConfigFile(nextConfig, configPath);
  if (existingConfigText !== null && existingConfigText === finalConfigText && !tokenCreated) {
    printInitSummary(io, {
      authToken,
      baseUrl,
      commandPrefix,
      configPath: displayConfigPath,
      dashboardEnabled,
      tokenCreated: false,
      wroteConfig: false,
    });
    return 0;
  }

  try {
    await writeConfigFile(configPath, nextConfig);
  } catch (error) {
    if (createdKeyId) {
      await authManager.revokeKey(createdKeyId);
    }
    writeLine(io.stderr, `  ❌ Failed to write ${displayConfigPath}: ${getErrorMessage(error)}`);
    return 1;
  }

  printInitSummary(io, {
    authToken,
    baseUrl,
    commandPrefix,
    configPath: displayConfigPath,
    dashboardEnabled,
    tokenCreated,
    wroteConfig: true,
  });
  return 0;
}

// --- Doctor helpers (exported) ---

export async function findStarterTemplateFiles(): Promise<StarterTemplateCheckFile[]> {
  const templates = await loadTemplateGallery();
  return templates.flatMap((template) => template.targets.map((targetPath) => ({
    displayPath: renderTemplatePath(targetPath),
    targetPath: resolveTemplateRelativePath(process.cwd(), targetPath),
    templateName: template.name,
  }))).filter((entry) => existsSync(entry.targetPath));
}

export async function handleStarterTemplateDoctor(
  io: CliIO,
  filesToCheck: readonly StarterTemplateCheckFile[],
): Promise<number> {
  writeLine(io.stdout, '  Starter template health checks:');
  let failed = false;

  for (const file of filesToCheck) {
    const content = await readFile(file.targetPath, 'utf-8');
    const issues: string[] = [];
    if (!hasTemplateHeading(content)) {
      issues.push('missing a top-level heading');
    }
    if (!hasTemplateDescription(content)) {
      issues.push('missing description frontmatter');
    }
    if (!hasTemplateCustomizationGuide(content)) {
      issues.push('missing "Customize This Template" guidance');
    }

    if (issues.length === 0) {
      writeLine(io.stdout, `    ✅ ${file.displayPath} (${file.templateName})`);
    } else {
      failed = true;
      writeLine(io.stderr, `    ❌ ${file.displayPath} (${file.templateName}) — ${issues.join('; ')}`);
    }
  }

  if (!failed) {
    writeLine(io.stdout, `  ✅ Checked ${filesToCheck.length} starter template file(s).`);
  }
  return failed ? 1 : 0;
}
