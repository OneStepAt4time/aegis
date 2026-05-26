/**
 * api/metrics.ts — Metrics endpoints.
 */

import type { GlobalMetrics } from '../types';
import { GlobalMetricsSchema } from './schemas';
import { request } from './base';

export function getMetrics(): Promise<GlobalMetrics> {
  return request('/v1/metrics', { schema: GlobalMetricsSchema, schemaContext: 'getMetrics' });
}

// Issue #2087: Metrics aggregation
export interface AggregateMetricsResponse {
  summary: {
    totalSessions: number;
    avgDurationSeconds: number;
    totalTokenCostUsd: number;
    totalMessages: number;
    totalToolCalls: number;
    permissionsApproved: number;
    permissionApprovalRate: number | null;
    stalls: number;
  };
  timeSeries: Array<{ timestamp: string; sessions: number; messages: number; toolCalls: number; tokenCostUsd: number }>;
  byKey: Array<{ keyId: string; keyName: string; sessions: number; messages: number; toolCalls: number; tokenCostUsd: number }>;
  anomalies: Array<{ sessionId: string; tokenCostUsd: number; reason: string }>;
}

export interface FetchMetricsAggregateParams {
  from?: string;
  to?: string;
  groupBy?: 'day' | 'hour' | 'key';
}

export async function getMetricsAggregate(params: FetchMetricsAggregateParams = {}): Promise<AggregateMetricsResponse> {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.groupBy) searchParams.set('groupBy', params.groupBy);
  const query = searchParams.toString();
  const path = query ? `/v1/metrics/aggregate?${query}` : '/v1/metrics/aggregate';
  return request<AggregateMetricsResponse>(path);
}
