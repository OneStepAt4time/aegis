import { z } from 'zod';

export const sessionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  status: z.string().optional(),
  ownerKeyId: z.string().optional(),
  name: z.string().optional(),
  createdAfter: z.coerce.number().optional(),
  createdBefore: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'lastSeenAt', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

type SessionHistoryQuery = z.infer<typeof sessionHistoryQuerySchema>;

export interface SessionHistoryRecord {
  id: string;
  ownerKeyId?: string;
  tenantId?: string;
  createdAt?: number;
  endedAt?: number;
  lastSeenAt: number;
  finalStatus: 'active' | 'killed' | 'unknown';
  source: 'audit' | 'live' | 'audit+live';
}

function queryTimestampToMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function applySessionHistoryQuery(
  records: SessionHistoryRecord[],
  query: SessionHistoryQuery,
): SessionHistoryRecord[] {
  const nameFilter = query.name?.trim().toLowerCase();
  const createdAfter = queryTimestampToMs(query.createdAfter);
  const createdBefore = queryTimestampToMs(query.createdBefore);
  const sortBy = query.sortBy ?? 'lastSeenAt';
  const sortOrder = query.sortOrder ?? 'desc';

  let history = query.status ? records.filter(h => h.finalStatus === query.status) : records;
  if (nameFilter) {
    history = history.filter(h => h.id.toLowerCase().includes(nameFilter) || (h.ownerKeyId?.toLowerCase().includes(nameFilter) ?? false));
  }
  if (createdAfter !== undefined) history = history.filter(h => (h.createdAt ?? h.lastSeenAt) >= createdAfter);
  if (createdBefore !== undefined) history = history.filter(h => (h.createdAt ?? h.lastSeenAt) <= createdBefore);

  return history.sort((a, b) => {
    let comparison = sortBy === 'createdAt'
      ? (a.createdAt ?? a.lastSeenAt) - (b.createdAt ?? b.lastSeenAt)
      : sortBy === 'status'
        ? a.finalStatus.localeCompare(b.finalStatus)
        : a.lastSeenAt - b.lastSeenAt;
    if (comparison === 0) comparison = (a.createdAt ?? 0) - (b.createdAt ?? 0);
    return sortOrder === 'asc' ? comparison : -comparison;
  });
}
