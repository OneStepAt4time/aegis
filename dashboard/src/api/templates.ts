/**
 * api/templates.ts — Session template CRUD.
 */

import type { OkResponse, SessionTemplate } from '../types';
import { request } from './base';

export function createTemplate(opts: {
  name: string;
  description?: string;
  sessionId?: string;
  workDir?: string;
  prompt?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: string;
  autoApprove?: boolean;
  memoryKeys?: string[];
}): Promise<SessionTemplate> {
  return request('/v1/templates', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getTemplates(): Promise<SessionTemplate[]> {
  return request('/v1/templates');
}

export function getTemplate(id: string): Promise<SessionTemplate> {
  return request(`/v1/templates/${encodeURIComponent(id)}`);
}

export function updateTemplate(id: string, updates: Partial<Parameters<typeof createTemplate>[0]>): Promise<SessionTemplate> {
  return request(`/v1/templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function deleteTemplate(id: string): Promise<OkResponse> {
  return request(`/v1/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
