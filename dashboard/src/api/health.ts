/**
 * api/health.ts — Health check endpoints.
 */

import type { HealthResponse } from '../types';
import { HealthResponseSchema } from './schemas';
import { request } from './base';

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request('/v1/health', { schema: HealthResponseSchema, schemaContext: 'getHealth', signal });
}

/**
 * Probe whether the server requires authentication.
 * Returns true if an authenticated endpoint (/v1/sessions) responds without a Bearer token.
 * Used by the zero-config flow to skip login on localhost.
 */
export async function probePublicAccess(): Promise<boolean> {
  try {
    const { BASE_URL, getAuthHeaders } = await import('./base');
    const res = await fetch(`${BASE_URL}/v1/sessions?limit=1`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(),
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}
