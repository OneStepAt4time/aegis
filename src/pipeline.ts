/**
 * pipeline.ts — Batch create and pipeline orchestration.
 *
 * Issue #36: Create multiple sessions in parallel, or define
 * sequential pipelines with stage dependencies.
 */

import { type SessionManager, type SessionInfo } from './session.js';
import { type SessionEventBus } from './events.js';
import { getErrorMessage } from './validation.js';
import { shouldRetry } from './error-categories.js';
import { retryWithJitter } from './retry.js';

export interface BatchSessionSpec {
  name?: string;
  workDir: string;
  prompt?: string;
  permissionMode?: string;
  /** @deprecated Use permissionMode instead. */
  autoApprove?: boolean;
  stallThresholdMs?: number;
}

export interface BatchResult {
  sessions: Array<{
    id: string;
    name: string;
    promptDelivery?: { delivered: boolean; attempts: number };
  }>;
  created: number;
  failed: number;
  errors: string[];
}

export interface PipelineStage {
  name: string;
  workDir?: string;
  prompt: string;
  dependsOn?: string[];
  permissionMode?: string;
  /** @deprecated Use permissionMode instead. */
  autoApprove?: boolean;
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

export class PipelineManager {
  private static readonly PIPELINE_RETRY_MAX_ATTEMPTS = 3;
  private static readonly PIPELINE_FIX_MAX_RETRIES = 3;

  private pipelines = new Map<string, PipelineState>();
  private pipelineConfigs = new Map<string, PipelineConfig>(); // #219: preserve original stage config
  private pollInterval: NodeJS.Timeout | null = null;
  private cleanupTimers = new Map<string, NodeJS.Timeout>(); // #1092: track cleanup timers per pipeline

  constructor(
    private sessions: SessionManager,
    private eventBus?: SessionEventBus,
  ) {}

  /** Create multiple sessions in parallel. */
  async batchCreate(specs: BatchSessionSpec[]): Promise<BatchResult> {
    const results = await Promise.allSettled(
      specs.map(async (spec) => {
        const session = await this.sessions.createSession({
          workDir: spec.workDir,
          name: spec.name,
          permissionMode: spec.permissionMode,
          autoApprove: spec.autoApprove,
          stallThresholdMs: spec.stallThresholdMs,
        });

        let promptDelivery: { delivered: boolean; attempts: number } | undefined;
        if (spec.prompt) {
          promptDelivery = await this.sessions.sendInitialPrompt(session.id, spec.prompt);
        }

        return {
          id: session.id,
          name: session.windowName,
          promptDelivery,
        };
      }),
    );

    const sessions: BatchResult['sessions'] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        sessions.push(result.value);
      } else {
        errors.push(result.reason?.message || 'Unknown error');
      }
    }

    return {
      sessions,
      created: sessions.length,
      failed: errors.length,
      errors,
    };
  }

  /** Create a pipeline with stage dependencies. */
  async createPipeline(config: PipelineConfig): Promise<PipelineState> {
    const id = crypto.randomUUID();

    // Validate: all dependsOn references must exist as stage names
    const stageNames = new Set(config.stages.map(s => s.name));
    for (const stage of config.stages) {
      for (const dep of stage.dependsOn || []) {
        if (!stageNames.has(dep)) {
          throw new Error(`Stage "${stage.name}" depends on unknown stage "${dep}"`);
        }
      }
    }

    // Check for circular dependencies
    this.detectCycles(config.stages);

    const pipeline: PipelineState = {
      id,
      name: config.name,
      currentStage: 'plan',
      status: 'running',
      retryCount: 0,
      maxRetries: PipelineManager.PIPELINE_FIX_MAX_RETRIES,
      stageHistory: [{ stage: 'plan', enteredAt: Date.now() }],
      stages: config.stages.map(s => ({
        name: s.name,
        status: 'pending' as PipelineStageStatus,
        dependsOn: s.dependsOn || [],
      })),
      createdAt: Date.now(),
    };

    this.pipelines.set(id, pipeline);
    this.pipelineConfigs.set(id, config); // #219: store original config for polling

    // Start stages with no dependencies immediately
    await this.advancePipeline(id, config);

    // Start polling for stage completion
    if (!this.pollInterval) {
      this.pollInterval = setInterval(() => this.pollPipelines(), 5000);
    }

    return pipeline;
  }

  /** Get pipeline state. */
  getPipeline(id: string): PipelineState | null {
    return this.pipelines.get(id) || null;
  }

  /** List all pipelines. */
  listPipelines(): PipelineState[] {
    return Array.from(this.pipelines.values());
  }

  /** Advance a pipeline: start stages whose dependencies are met. */
  private async advancePipeline(id: string, config: PipelineConfig): Promise<void> {
    const pipeline = this.pipelines.get(id);
    if (!pipeline || pipeline.status !== 'running') return;

    const completedStages = new Set(
      pipeline.stages.filter(s => s.status === 'completed').map(s => s.name),
    );
    const failedStages = pipeline.stages.filter(s => s.status === 'failed');

    // If any stage failed, fail the pipeline
    if (failedStages.length > 0) {
      pipeline.status = 'failed';
      this.transitionPipelineStage(pipeline, 'fix', { reason: 'stage_failed', failedStages: failedStages.map(s => s.name) });
      return;
    }

    // Check if all stages are completed
    if (pipeline.stages.every(s => s.status === 'completed')) {
      pipeline.status = 'completed';
      this.transitionPipelineStage(pipeline, 'submit', { reason: 'all_stages_completed' });
      this.transitionPipelineStage(pipeline, 'done', { status: 'completed' });
      if (this.eventBus) {
        this.eventBus.emitEnded(id, 'pipeline_completed');
      }
      return;
    }

    // Start pending stages whose dependencies are all completed
    for (const stage of pipeline.stages) {
      if (stage.status !== 'pending') continue;
      const depsComplete = stage.dependsOn.every(d => completedStages.has(d));
      if (!depsComplete) continue;

      // Find matching config stage
      const stageConfig = config.stages.find(s => s.name === stage.name);
      if (!stageConfig) continue;

      try {
        const session = await retryWithJitter(
          async () => this.sessions.createSession({
            workDir: stageConfig.workDir || config.workDir,
            name: `pipeline-${config.name}-${stage.name}`,
            permissionMode: stageConfig.permissionMode,
            autoApprove: stageConfig.autoApprove,
          }),
          {
            maxAttempts: PipelineManager.PIPELINE_RETRY_MAX_ATTEMPTS,
            shouldRetry: (error) => shouldRetry(error),
          },
        );

        if (stageConfig.prompt) {
          await retryWithJitter(
            async () => this.sessions.sendInitialPrompt(session.id, stageConfig.prompt),
            {
              maxAttempts: PipelineManager.PIPELINE_RETRY_MAX_ATTEMPTS,
              shouldRetry: (error) => shouldRetry(error),
            },
          );
        }

        stage.sessionId = session.id;
        stage.status = 'running';
        stage.startedAt = Date.now();
        this.transitionPipelineStage(pipeline, 'execute', { stage: stage.name, sessionId: session.id });
      } catch (e: unknown) {
        stage.status = 'failed';
        stage.error = getErrorMessage(e);
        pipeline.status = 'failed';
        this.transitionPipelineStage(pipeline, 'fix', { stage: stage.name, error: stage.error });
      }
    }

    const hasRunning = pipeline.stages.some(s => s.status === 'running');
    const hasPending = pipeline.stages.some(s => s.status === 'pending');
    if (hasRunning) {
      this.transitionPipelineStage(pipeline, 'verify', { runningStages: pipeline.stages.filter(s => s.status === 'running').map(s => s.name) });
    } else if (hasPending) {
      this.transitionPipelineStage(pipeline, 'plan', { pendingStages: pipeline.stages.filter(s => s.status === 'pending').map(s => s.name) });
    }
  }

  /** Poll running pipelines and advance stages. */
  private async pollPipelines(): Promise<void> {
    // #830: Stop polling immediately when no pipelines remain, rather than
    // waiting for the 30s cleanup setTimeout to fire. Prevents ~6 no-op poll
    // cycles and stale config references during the cleanup window.
    if (this.pipelines.size === 0) {
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
      return;
    }

    for (const [id, pipeline] of this.pipelines) {
      if (pipeline.status !== 'running') continue;

      // Check running stages for completion (idle status = done)
      for (const stage of pipeline.stages) {
        if (stage.status !== 'running' || !stage.sessionId) continue;

        const session = this.sessions.getSession(stage.sessionId);
        if (!session) {
          stage.status = 'failed';
          stage.error = 'Session disappeared';
          continue;
        }

        if (session.status === 'idle') {
          stage.status = 'completed';
          stage.completedAt = Date.now();
          this.transitionPipelineStage(pipeline, 'verify', { stageCompleted: stage.name });
        }
      }

      // #219: Use stored original config so stage prompt/permissionMode/autoApprove/workDir are preserved
      const storedConfig = this.pipelineConfigs.get(id);
      if (storedConfig) {
        await this.advancePipeline(id, storedConfig);
      }

      // #221: Clean up completed/failed pipelines after 30s to avoid memory leak
      // Note: advancePipeline may change status from 'running' to 'completed'/'failed'
      // #1092: Track cleanup timer to prevent duplicates and allow destroy() cleanup
      if (pipeline.status !== 'running' && !this.cleanupTimers.has(id)) {
        const pipelineId = id;
        const timer = setTimeout(() => {
          this.cleanupTimers.delete(pipelineId);
          this.pipelines.delete(pipelineId);
          this.pipelineConfigs.delete(pipelineId); // #219: clean up stored config
          // #578: Stop polling when no pipelines remain
          if (this.pipelines.size === 0 && this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
          }
        }, 30_000);
        this.cleanupTimers.set(pipelineId, timer);
      }
    }
  }

  private transitionPipelineStage(
    pipeline: PipelineState,
    stage: PipelineState['currentStage'],
    output?: unknown,
  ): void {
    if (pipeline.currentStage === stage) return;
    const now = Date.now();
    const previous = pipeline.stageHistory[pipeline.stageHistory.length - 1];
    if (previous && previous.exitedAt === undefined) {
      previous.exitedAt = now;
      if (output !== undefined) previous.output = output;
    }
    pipeline.currentStage = stage;
    pipeline.stageHistory.push({ stage, enteredAt: now });

    if (stage === 'fix') {
      pipeline.retryCount += 1;
      if (pipeline.retryCount > pipeline.maxRetries) {
        pipeline.status = 'failed';
      }
    }
  }

  /** Detect circular dependencies. Throws if found. */
  private detectCycles(stages: PipelineStage[]): void {
    const graph = new Map<string, string[]>();
    for (const stage of stages) {
      graph.set(stage.name, stage.dependsOn || []);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): void => {
      if (inStack.has(node)) throw new Error(`Circular dependency detected involving stage "${node}"`);
      if (visited.has(node)) return;

      inStack.add(node);
      visited.add(node);
      for (const dep of graph.get(node) || []) {
        dfs(dep);
      }
      inStack.delete(node);
    };

    for (const stage of stages) {
      dfs(stage.name);
    }
  }

  /** Clean up. */
  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    // #1092: Clear all pending cleanup timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    // #1092: Clear maps to release memory
    this.pipelines.clear();
    this.pipelineConfigs.clear();
  }
}
