import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadContinuationPointers } from '../continuation-pointer.js';

describe('Issue #900: continuation pointer storage', () => {
  let tmpDir: string;

  const validEntry = {
    session_id: '00000000-0000-0000-0000-000000000001',
    cwd: '/tmp/project',
    window_name: 'cc-test',
    written_at: 1_000,
  };

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    tmpDir = '';
  });

  it('drops invalid entries and keeps valid pointers', async () => {
    const mapFile = setupMapFile({
      'aegis:@1': validEntry,
      'aegis:@2': { broken: true },
    });

    const result = await loadContinuationPointers(mapFile, 10_000, 2_000);

    expect(Object.keys(result)).toEqual(['aegis:@1']);
    expect(result['aegis:@1'].schema_version).toBe(1);
    expect(result['aegis:@1'].expires_at).toBe(11_000);
  });

  it('drops stale legacy pointer using written_at + TTL', async () => {
    const mapFile = setupMapFile({
      'aegis:@1': {
        ...validEntry,
        written_at: 1_000,
      },
    });

    const result = await loadContinuationPointers(mapFile, 5_000, 6_500);

    expect(result).toEqual({});
  });

  it('honors expires_at when provided', async () => {
    const mapFile = setupMapFile({
      'aegis:@1': {
        ...validEntry,
        expires_at: 5_000,
      },
    });

    const result = await loadContinuationPointers(mapFile, 100_000, 6_000);

    expect(result).toEqual({});
  });

  it('self-heals corrupted JSON by resetting to empty map', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-pointer-test-'));
    const mapFile = join(tmpDir, 'session_map.json');
    writeFileSync(mapFile, '{ not-valid-json');

    const result = await loadContinuationPointers(mapFile, 10_000, 2_000);

    expect(result).toEqual({});
    expect(readFileSync(mapFile, 'utf-8')).toBe('{}');
  });

  function setupMapFile(data: Record<string, unknown>): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-pointer-test-'));
    mkdirSync(tmpDir, { recursive: true });
    const mapFile = join(tmpDir, 'session_map.json');
    writeFileSync(mapFile, JSON.stringify(data, null, 2));
    return mapFile;
  }
});
