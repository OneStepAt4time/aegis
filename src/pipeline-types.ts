/**
 * pipeline-types.ts — Shared type interfaces for the pipeline subsystem.
 *
 * Extracted from pipeline.ts to break the circular dependency:
 *   pipeline.ts ↔ state-store.ts
 *
 * Both files import types from here instead of from each other.
 */

export interface PipelineStage {
  name: string;
  workDir?: string;
  prompt: string;
  dependsOn?: string[];
  permissionMode?: string;
  /** @deprecated Use permissionMode instead. */
  autoApprove?: boolean;
  stageTimeoutMs?: number;
}

export interface PipelineConfig {
  name: string;
  workDir: string;  // Default workDir for all stages
  stages: PipelineStage[];
}

export type PipelineStageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PipelineState {
  id: string;
  name: string;
  currentStage: 'plan' | 'execute' | 'verify' | 'fix' | 'submit' | 'done';
  status: 'running' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
  stageHistory: Array<{
    stage: string;
    enteredAt: number;
    exitedAt?: number;
    output?: unknown;
  }>;
  stages: Array<{
    name: string;
    status: PipelineStageStatus;
    sessionId?: string;
    dependsOn: string[];
    startedAt?: number;
    completedAt?: number;
    error?: string;
  }>;
  createdAt: number;
}
