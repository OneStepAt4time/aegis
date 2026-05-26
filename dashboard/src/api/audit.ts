/**
 * api/audit.ts — Audit trail endpoints.
 */

import type {
  AuditChainMetadata,
  AuditIntegrityMetadata,
  AuditPageResponse,
} from '../types/index.js';
import { AuditPageResponseSchema } from './schemas';
import { request, requestResponse } from './base';

export interface FetchAuditLogsParams {
  limit?: number;
  cursor?: string;
  actor?: string;
  action?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  reverse?: boolean;
  verify?: boolean;
  signal?: AbortSignal;
}

export type AuditExportFormat = 'csv' | 'ndjson';

export interface ExportAuditLogsParams extends Omit<FetchAuditLogsParams, 'limit' | 'cursor'> {
  format: AuditExportFormat;
}

export interface AuditExportResult {
  filename: string;
  format: AuditExportFormat;
  mimeType: string;
  chain: AuditChainMetadata;
  integrity?: AuditIntegrityMetadata;
}

interface AuditQueryParams extends Omit<FetchAuditLogsParams, 'signal'> {
  format?: 'json' | AuditExportFormat;
}

function buildAuditSearchParams(params: AuditQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
  if (params.cursor) searchParams.set('cursor', params.cursor);
  if (params.actor) searchParams.set('actor', params.actor);
  if (params.action) searchParams.set('action', params.action);
  if (params.sessionId) searchParams.set('sessionId', params.sessionId);
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.reverse !== undefined) searchParams.set('reverse', String(params.reverse));
  if (params.verify !== undefined) searchParams.set('verify', String(params.verify));
  if (params.format) searchParams.set('format', params.format);
  return searchParams;
}

function parseAuditExportFilename(headers: Headers, format: AuditExportFormat): string {
  const disposition = headers.get('Content-Disposition') ?? '';
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  if (quotedMatch) return quotedMatch[1];

  const plainMatch = disposition.match(/filename=([^;]+)/i);
  if (plainMatch) return plainMatch[1].trim();

  return `audit-export.${format}`;
}

function parseAuditChainMetadata(headers: Headers): AuditChainMetadata {
  const count = Number.parseInt(headers.get('X-Aegis-Audit-Record-Count') ?? '0', 10);
  return {
    count: Number.isFinite(count) ? count : 0,
    firstHash: headers.get('X-Aegis-Audit-First-Hash'),
    lastHash: headers.get('X-Aegis-Audit-Last-Hash'),
    badgeHash: headers.get('X-Aegis-Audit-Chain-Badge'),
    firstTs: headers.get('X-Aegis-Audit-First-Ts'),
    lastTs: headers.get('X-Aegis-Audit-Last-Ts'),
  };
}

function parseAuditIntegrityMetadata(headers: Headers): AuditIntegrityMetadata | undefined {
  const validHeader = headers.get('X-Aegis-Audit-Integrity-Valid');
  if (validHeader === null) return undefined;

  const brokenAtHeader = headers.get('X-Aegis-Audit-Integrity-Broken-At');
  const brokenAtValue = brokenAtHeader ? Number.parseInt(brokenAtHeader, 10) : undefined;
  const file = headers.get('X-Aegis-Audit-Integrity-File');

  return {
    valid: validHeader === 'true',
    ...(brokenAtValue !== undefined && Number.isFinite(brokenAtValue) ? { brokenAt: brokenAtValue } : {}),
    ...(file ? { file } : {}),
  };
}

function downloadText(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function fetchAuditLogs(params: FetchAuditLogsParams = {}): Promise<AuditPageResponse> {
  const { signal, ...queryParams } = params;
  const searchParams = buildAuditSearchParams({ ...queryParams, format: 'json' });
  const query = searchParams.toString();
  const path = query ? `/v1/audit?${query}` : '/v1/audit';
  return request<AuditPageResponse>(path, {
    signal,
    schema: AuditPageResponseSchema,
    schemaContext: 'fetchAuditLogs',
  });
}

export async function exportAuditLogs(params: ExportAuditLogsParams): Promise<AuditExportResult> {
  const { signal, format, ...queryParams } = params;
  const searchParams = buildAuditSearchParams({
    ...queryParams,
    format,
    verify: queryParams.verify ?? true,
  });
  const query = searchParams.toString();
  const path = query ? `/v1/audit?${query}` : '/v1/audit';
  const accept = format === 'csv' ? 'text/csv' : 'application/x-ndjson';
  const response = await requestResponse(path, {
    signal,
    headers: {
      Accept: accept,
    },
  });
  const content = await response.text();
  const mimeType = response.headers.get('Content-Type') ?? accept;
  const filename = parseAuditExportFilename(response.headers, format);

  downloadText(content, mimeType, filename);

  return {
    filename,
    format,
    mimeType,
    chain: parseAuditChainMetadata(response.headers),
    integrity: parseAuditIntegrityMetadata(response.headers),
  };
}
