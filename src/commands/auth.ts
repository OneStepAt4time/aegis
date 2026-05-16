/**
 * commands/auth.ts — Auth management commands.
 *
 * `ag auth migrate` — migrate clientAuthToken from config.yaml to the
 * canonical auth-token file (single source of truth).
 *
 * Issue #3497.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { findConfigFilePath, loadConfig, readConfigFile, serializeConfigFile, type Config } from '../config.js';
import { getErrorMessage } from '../validation.js';
import { getAuthTokenFilePath, persistAuthTokenFile, readAuthTokenFile } from '../utils/auth-token-path.js';

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

/**
 * Migrate clientAuthToken from config.yaml to the canonical auth-token file.
 *
 * Steps:
 * 1. Read token from config.yaml clientAuthToken
 * 2. Write to canonical auth-token path
 * 3. Remove clientAuthToken from config.yaml
 * 4. Report what was migrated
 */
export async function handleAuthMigrate(_args: string[], io: CliIO): Promise<number> {
  const configPath = findConfigFilePath();

  if (!configPath) {
    writeLine(io.stderr, '  ❌ No config file found. Run `ag init` first.');
    return 1;
  }

  const existingConfig = await readConfigFile(configPath);
  if (!existingConfig) {
    writeLine(io.stderr, `  ❌ Could not parse config file: ${configPath}`);
    return 1;
  }

  const configToken = existingConfig.clientAuthToken;
  if (!configToken) {
    // Check if already migrated
    const fileToken = readAuthTokenFile();
    if (fileToken) {
      writeLine(io.stdout, '  ℹ️  No clientAuthToken in config — already using canonical auth-token file.');
      return 0;
    }
    writeLine(io.stdout, '  ℹ️  No clientAuthToken found in config. Nothing to migrate.');
    return 0;
  }

  // Write token to canonical path
  persistAuthTokenFile(configToken);

  // Verify it was written
  const verified = readAuthTokenFile();
  if (!verified) {
    writeLine(io.stderr, '  ❌ Failed to write auth-token file.');
    return 1;
  }

  // Remove clientAuthToken from config
  const updatedConfig: Partial<Config> = { ...existingConfig };
  delete updatedConfig.clientAuthToken;

  try {
    const content = serializeConfigFile(updatedConfig, configPath);
    await writeFile(configPath, content, 'utf-8');
  } catch (error) {
    writeLine(io.stderr, `  ❌ Failed to update config file: ${getErrorMessage(error)}`);
    return 1;
  }

  writeLine(io.stdout, '  ✅ Migrated clientAuthToken to canonical auth-token file.');
  writeLine(io.stdout, `     Source: ${configPath} (clientAuthToken removed)`);
  writeLine(io.stdout, `     Target: ${getAuthTokenFilePath()}`);
  return 0;
}
