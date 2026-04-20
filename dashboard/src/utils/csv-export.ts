/**
 * utils/csv-export.ts — Generate CSV from session history records.
 */

import type { SessionHistoryRecord } from '../api/client';

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function generateSessionHistoryCSV(records: SessionHistoryRecord[]): string {
  const headers = ['Session ID', 'Owner Key ID', 'Status', 'Source', 'Created At', 'Last Seen At'];
  const rows = records.map((r) => [
    escapeCSV(r.id),
    escapeCSV(r.ownerKeyId ?? ''),
    escapeCSV(r.finalStatus),
    escapeCSV(r.source),
    r.createdAt !== undefined ? new Date(r.createdAt).toISOString() : '',
    new Date(r.lastSeenAt).toISOString(),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
