/**
 * api/pipelines.ts — Pipeline CRUD endpoints.
 */

import { request } from './base';

export interface PipelineRequest {
  name: string;
  workDir: string;
  stages: { workDir: string; name?: string; prompt?: string }[];
}

export interface PipelineStageInfo {
  name: string;
  status: string;
  sessionId?: string;
  dependsOn?: string[];
}

export interface PipelineInfo {
  id: string;
  name: string;
  status: string;
  stages: PipelineStageInfo[];
  createdAt: number;
}

export function createPipeline(opts: PipelineRequest): Promise<PipelineInfo> {
  return request('/v1/pipelines', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function getPipelines(): Promise<PipelineInfo[]> {
  return request('/v1/pipelines');
}

export function getPipeline(id: string): Promise<PipelineInfo> {
  return request(`/v1/pipelines/${encodeURIComponent(id)}`);
}
