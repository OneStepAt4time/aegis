/**
 * pipeline.ts — Batch create and pipeline orchestration.
 *
 * Issue #36: Create multiple sessions in parallel, or define
 * sequential pipelines with stage dependencies.
 */

import { type SessionManager, type SessionInfo } from './session.js';
import { type SessionEventBus } from './events.js';

export interface BatchSessionSpec {
  name?: string;
  workDir: string;
  prompt?: string;
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
  status: 'running' | 'completed' | 'failed';
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
  private pipelines = new Map<string, PipelineState>();
  private pollInterval: NodeJS.Timeout | null = null;

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
      status: 'running',
      stages: config.stages.map(s => ({
        name: s.name,
        status: 'pending' as PipelineStageStatus,
        dependsOn: s.dependsOn || [],
      })),
      createdAt: Date.now(),
    };

    this.pipelines.set(id, pipeline);

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
      return;
    }

    // Check if all stages are completed
    if (pipeline.stages.every(s => s.status === 'completed')) {
      pipeline.status = 'completed';
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
        const session = await this.sessions.createSession({
          workDir: stageConfig.workDir || config.workDir,
          name: `pipeline-${config.name}-${stage.name}`,
          autoApprove: stageConfig.autoApprove,
        });

        if (stageConfig.prompt) {
          await this.sessions.sendInitialPrompt(session.id, stageConfig.prompt);
        }

        stage.sessionId = session.id;
        stage.status = 'running';
        stage.startedAt = Date.now();
      } catch (e: any) {
        stage.status = 'failed';
        stage.error = e.message;
        pipeline.status = 'failed';
      }
    }
  }

  /** Poll running pipelines and advance stages. */
  private async pollPipelines(): Promise<void> {
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
        }
      }

      // Re-create config from pipeline state for advance (minimal)
      const configStub: PipelineConfig = {
        name: pipeline.name,
        workDir: '',
        stages: pipeline.stages.map(s => ({ name: s.name, prompt: '', dependsOn: s.dependsOn })),
      };
      await this.advancePipeline(id, configStub);
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
  }
}
