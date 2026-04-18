import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findConfigFilePath, readConfigFile, reloadAllowedWorkDirs } from '../config.js';

describe('yaml config support', () => {
  let originalArgv: string[];
  let originalCwd: string;
  let testDir: string;

  beforeEach(() => {
    originalArgv = [...process.argv];
    originalCwd = process.cwd();
    testDir = mkdtempSync(join(tmpdir(), 'aegis-config-yaml-'));
    process.chdir(testDir);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it('reads .aegis/config.yaml files', async () => {
    const configDir = join(testDir, '.aegis');
    const configPath = join(configDir, 'config.yaml');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, [
      'baseUrl: http://127.0.0.1:9200',
      'dashboardEnabled: false',
      'allowedWorkDirs:',
      '  - ./workspace',
    ].join('\n'));

    const config = await readConfigFile(configPath);
    expect(config).toMatchObject({
      baseUrl: 'http://127.0.0.1:9200',
      dashboardEnabled: false,
      allowedWorkDirs: ['./workspace'],
    });
  });

  it('prefers .aegis/config.yaml in config discovery', () => {
    const configDir = join(testDir, '.aegis');
    const configPath = join(configDir, 'config.yaml');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, 'baseUrl: http://127.0.0.1:9100\n');

    expect(findConfigFilePath()).toBe(configPath);
  });

  it('reloads allowedWorkDirs from yaml config files', async () => {
    const configDir = join(testDir, '.aegis');
    const configPath = join(configDir, 'config.yaml');
    const workspaceDir = join(testDir, 'workspace');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    writeFileSync(configPath, [
      'allowedWorkDirs:',
      '  - ./workspace',
      '  - ./nested',
    ].join('\n'));

    const dirs = await reloadAllowedWorkDirs(configPath);

    expect(dirs).toEqual([
      resolve(workspaceDir),
      resolve(join(testDir, 'nested')),
    ]);
  });
});
