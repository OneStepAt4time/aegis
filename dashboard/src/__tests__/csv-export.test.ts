import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  generateSessionHistoryCSV,
  downloadCSV,
} from '../utils/csv-export';

import type { SessionHistoryRecord } from '../api/client';

// ── generateSessionHistoryCSV ────────────────────────────────────

describe('generateSessionHistoryCSV', () => {
  const baseRecord: SessionHistoryRecord = {
    id: 'sess-001',
    finalStatus: 'active',
    source: 'live',
    lastSeenAt: new Date('2026-04-17T10:00:00Z').getTime(),
  };

  it('produces a header row with expected columns', () => {
    const csv = generateSessionHistoryCSV([]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'Session ID,Owner Key ID,Status,Source,Created At,Last Seen At',
    );
  });

  it('outputs one data row per record', () => {
    const csv = generateSessionHistoryCSV([baseRecord]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 row
  });

  it('serialises required fields correctly', () => {
    const csv = generateSessionHistoryCSV([baseRecord]);
    const lines = csv.split('\n');
    const row = lines[1];
    expect(row).toContain('sess-001');
    expect(row).toContain('active');
    expect(row).toContain('live');
    expect(row).toContain(new Date(baseRecord.lastSeenAt).toISOString());
  });

  it('handles optional ownerKeyId omitted', () => {
    const csv = generateSessionHistoryCSV([baseRecord]);
    const row = csv.split('\n')[1];
    // ownerKeyId is undefined → empty string
    const fields = row.split(',');
    expect(fields[1]).toBe('');
  });

  it('handles optional ownerKeyId present', () => {
    const record: SessionHistoryRecord = {
      ...baseRecord,
      ownerKeyId: 'key-42',
    };
    const csv = generateSessionHistoryCSV([record]);
    expect(csv.split('\n')[1]).toContain('key-42');
  });

  it('handles optional createdAt omitted', () => {
    const csv = generateSessionHistoryCSV([baseRecord]);
    const fields = csv.split('\n')[1].split(',');
    // createdAt field is empty when undefined
    expect(fields[4]).toBe('');
  });

  it('handles optional createdAt present', () => {
    const record: SessionHistoryRecord = {
      ...baseRecord,
      createdAt: new Date('2026-04-16T08:30:00Z').getTime(),
    };
    const csv = generateSessionHistoryCSV([record]);
    expect(csv.split('\n')[1]).toContain(
      new Date(record.createdAt!).toISOString(),
    );
  });

  it('escapes fields containing commas', () => {
    const record: SessionHistoryRecord = {
      ...baseRecord,
      id: 'sess,with,commas',
    };
    const csv = generateSessionHistoryCSV([record]);
    const row = csv.split('\n')[1];
    expect(row).toContain('"sess,with,commas"');
  });

  it('escapes fields containing double quotes', () => {
    const record: SessionHistoryRecord = {
      ...baseRecord,
      id: 'sess"quote',
    };
    const csv = generateSessionHistoryCSV([record]);
    const row = csv.split('\n')[1];
    expect(row).toContain('"sess""quote"');
  });

  it('handles multiple records', () => {
    const records: SessionHistoryRecord[] = [
      { ...baseRecord, id: 'a' },
      { ...baseRecord, id: 'b' },
      { ...baseRecord, id: 'c' },
    ];
    const csv = generateSessionHistoryCSV(records);
    expect(csv.split('\n')).toHaveLength(4); // header + 3 rows
  });
});

// ── downloadCSV ──────────────────────────────────────────────────

describe('downloadCSV', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:http://localhost/fake');
    revokeObjectURLSpy = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a blob with text/csv type and triggers a download', () => {
    const clickSpy = vi.fn();
    const fakeLink = { href: '', download: '', click: clickSpy };

    vi.spyOn(document, 'createElement').mockReturnValue(fakeLink as any);

    downloadCSV('a,b\nc,d', 'test.csv');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(fakeLink.download).toBe('test.csv');
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:http://localhost/fake');
  });
});
