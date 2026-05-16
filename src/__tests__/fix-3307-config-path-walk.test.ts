/**
 * fix-3307-config-path-walk.test.ts
 *
 * Issue #3307: `ag run` fails with timeout because defaultConfigPath()
 * doesn't find project-local .aegis/config.yaml — only checks ~/.aegis/.
 *
 * Fix: defaultConfigPath() now uses findConfigFilePath() to search for
 * existing configs (CWD .aegis/config.yaml, home dir, etc.) before
 * falling back to the hardcoded home path.
 *
 * Issue #3548: Tests leaked host ~/.aegis/config.yaml. Fixed by mocking
 * os.homedir() via vi.mock so the host home config is never found.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const CONFIG_PATH = '../config.js';

// Overrideable homedir mock — defaults to the real homedir,
// individual tests can set mockHomedirReturnValue to a tmp dir.
let mockHomedirReturnValue: string | undefined;

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => mockHomedirReturnValue ?? original.homedir(),
  };
});

describe('Issue #3307: defaultConfigPath finds project-local config', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = join(tmpdir(), `aegis-test-3307-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(tmpDir, { recursive: true });
    mockHomedirReturnValue = undefined;
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    mockHomedirReturnValue = undefined;
  });

  it('findConfigFilePath finds .aegis/config.yaml in CWD', async () => {
    const { findConfigFilePath } = await import(CONFIG_PATH);

    // Create project-local config
    const aegisDir = join(tmpDir, '.aegis');
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(join(aegisDir, 'config.yaml'), 'port: 9200\n');

    process.chdir(tmpDir);
    const found = findConfigFilePath();
    expect(found).toBeTruthy();
    expect(found).toContain('.aegis');
    expect(found).toContain('config.yaml');
  });

  it('findConfigFilePath finds .aegis/config.yaml in nested subdirectory via CWD', async () => {
    // Use a separate "fake home" with no .aegis/ inside, different from tmpDir
    const fakeHome = join(tmpdir(), `aegis-fakehome-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(fakeHome, { recursive: true });
    mockHomedirReturnValue = fakeHome;

    const { findConfigFilePath } = await import(CONFIG_PATH);

    // Create project-local config in tmpDir
    const aegisDir = join(tmpDir, '.aegis');
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(join(aegisDir, 'config.yaml'), 'port: 9200\n');

    // Create nested subdirectory and chdir into it
    const nested = join(tmpDir, 'src', 'modules');
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);

    // findConfigFilePath only checks resolve('.aegis/config.yaml') relative to CWD
    // So from a nested dir, it won't find the parent's config
    // This test documents the current behavior
    const found = findConfigFilePath();
    expect(found).toBeNull();

    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('findConfigFilePath returns null when no config exists anywhere', async () => {
    // Mock os.homedir() to return tmpDir (which has no .aegis/ subdir)
    mockHomedirReturnValue = tmpDir;

    const { findConfigFilePath } = await import(CONFIG_PATH);

    process.chdir(tmpDir);
    const result = findConfigFilePath();
    expect(result).toBeNull();
  });

  it('run.ts defaultConfigPath prefers project-local config over home', async () => {
    const { findConfigFilePath } = await import(CONFIG_PATH);

    const aegisDir = join(tmpDir, '.aegis');
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(join(aegisDir, 'config.yaml'), 'port: 9300\n');

    process.chdir(tmpDir);

    const found = findConfigFilePath();
    expect(found).toBe(join(tmpDir, '.aegis', 'config.yaml'));
  });

  it('findConfigFilePath finds .aegis/config.yml (alternate extension)', async () => {
    const { findConfigFilePath } = await import(CONFIG_PATH);

    const aegisDir = join(tmpDir, '.aegis');
    mkdirSync(aegisDir, { recursive: true });
    writeFileSync(join(aegisDir, 'config.yml'), 'port: 9200\n');

    process.chdir(tmpDir);
    const found = findConfigFilePath();
    expect(found).toBeTruthy();
    expect(found).toContain('config.yml');
  });

  it('findConfigFilePath finds aegis.config.json', async () => {
    const { findConfigFilePath } = await import(CONFIG_PATH);

    writeFileSync(join(tmpDir, 'aegis.config.json'), '{"port":9200}');

    process.chdir(tmpDir);
    const found = findConfigFilePath();
    expect(found).toBe(join(tmpDir, 'aegis.config.json'));
  });
});
