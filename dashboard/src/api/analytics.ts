/**
 * api/analytics.ts — Analytics and cost endpoints.
 */

import type {
  AnalyticsSummary,
  RateLimitAnalyticsResponse,
  AnalyticsCostsResponse,
  CostSummaryResponse,
  CostByModelResponse,
  SessionCostEntry,
} from '../types';
import { request } from './base';

export function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return request('/v1/analytics/summary');
}

// Issue #2283: Rate-limit analytics
export function getRateLimitAnalytics(): Promise<RateLimitAnalyticsResponse> {
  return request('/v1/analytics/rate-limits');
}

// Issue #2802: Cost analytics
export function getAnalyticsCosts(): Promise<AnalyticsCostsResponse> {
  return request('/v1/analytics/costs');
}

/** GET /v1/cost/summary — Aggregate cost with burn rate. */
export function getCostSummary(params?: { from?: string; to?: string }): Promise<CostSummaryResponse> {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  const qs = searchParams.toString();
  return request(`/v1/cost/summary${qs ? `?${qs}` : ""}`);
}

/** GET /v1/cost/by-model — Cost grouped by model. */
export function getCostByModel(params?: { from?: string; to?: string }): Promise<CostByModelResponse> {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  const qs = searchParams.toString();
  return request(`/v1/cost/by-model${qs ? `?${qs}` : ""}`);
}

export async function getSessionCost(id: string): Promise<SessionCostEntry | null> {
  try {
    return await request<SessionCostEntry>(`/v1/sessions/${encodeURIComponent(id)}/cost`);
  } catch {
    return null;
  }
}
