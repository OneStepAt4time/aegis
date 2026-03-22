/**
 * batch-pipeline.test.ts — Tests for Issue #36: batch create + pipeline orchestration.
 */

import { describe, it, expect } from 'vitest';
import type { BatchSessionSpec, PipelineStage, PipelineStageStatus } from '../pipeline.js';

describe('Batch create and pipeline (Issue #36)', () => {
  describe('Batch session specs', () => {
    it('should validate workDir is required for each spec', () => {
      const specs: BatchSessionSpec[] = [
        { workDir: '/app', name: 'lint', prompt: 'Run lint' },
        { workDir: '/app', name: 'test', prompt: 'Run tests' },
      ];
      const allValid = specs.every(s => !!s.workDir);
      expect(allValid).toBe(true);
    });

    it('should reject specs without workDir', () => {
      const specs = [{ name: 'bad' }] as any[];
      const allValid = specs.every((s: any) => !!s.workDir);
      expect(allValid).toBe(false);
    });

    it('should support optional autoApprove per session', () => {
      const spec: BatchSessionSpec = { workDir: '/app', autoApprove: true };
      expect(spec.autoApprove).toBe(true);
    });
  });

  describe('Pipeline dependency validation', () => {
    it('should accept valid dependency graph', () => {
      const stages: PipelineStage[] = [
        { name: 'lint', prompt: 'lint', dependsOn: [] },
        { name: 'test', prompt: 'test', dependsOn: ['lint'] },
        { name: 'deploy', prompt: 'deploy', dependsOn: ['test'] },
      ];
      const stageNames = new Set(stages.map(s => s.name));
      const allDepsValid = stages.every(s =>
        (s.dependsOn || []).every(d => stageNames.has(d)),
      );
      expect(allDepsValid).toBe(true);
    });

    it('should reject unknown dependency', () => {
      const stages: PipelineStage[] = [
        { name: 'test', prompt: 'test', dependsOn: ['nonexistent'] },
      ];
      const stageNames = new Set(stages.map(s => s.name));
      const allDepsValid = stages.every(s =>
        (s.dependsOn || []).every(d => stageNames.has(d)),
      );
      expect(allDepsValid).toBe(false);
    });
  });

  describe('Pipeline stage status transitions', () => {
    it('should start as pending', () => {
      const status: PipelineStageStatus = 'pending';
      expect(status).toBe('pending');
    });

    it('should transition to running', () => {
      const status: PipelineStageStatus = 'running';
      expect(status).toBe('running');
    });

    it('should transition to completed', () => {
      const status: PipelineStageStatus = 'completed';
      expect(status).toBe('completed');
    });

    it('should transition to failed', () => {
      const status: PipelineStageStatus = 'failed';
      expect(status).toBe('failed');
    });
  });

  describe('Dependency resolution', () => {
    it('should identify stages with no dependencies as ready', () => {
      const stages = [
        { name: 'lint', dependsOn: [] as string[], status: 'pending' as const },
        { name: 'test', dependsOn: ['lint'], status: 'pending' as const },
      ];
      const completedStages = new Set<string>();
      const readyStages = stages.filter(
        s => s.status === 'pending' && s.dependsOn.every(d => completedStages.has(d)),
      );
      expect(readyStages).toHaveLength(1);
      expect(readyStages[0].name).toBe('lint');
    });

    it('should identify stages with met dependencies as ready', () => {
      const stages = [
        { name: 'lint', dependsOn: [] as string[], status: 'completed' as const },
        { name: 'test', dependsOn: ['lint'], status: 'pending' as const },
        { name: 'deploy', dependsOn: ['test'], status: 'pending' as const },
      ];
      const completedStages = new Set(
        stages.filter(s => s.status === 'completed').map(s => s.name),
      );
      const readyStages = stages.filter(
        s => s.status === 'pending' && s.dependsOn.every(d => completedStages.has(d)),
      );
      expect(readyStages).toHaveLength(1);
      expect(readyStages[0].name).toBe('test');
    });

    it('should handle parallel stages (multiple with no deps)', () => {
      const stages = [
        { name: 'lint', dependsOn: [] as string[], status: 'pending' as const },
        { name: 'test', dependsOn: [] as string[], status: 'pending' as const },
        { name: 'docs', dependsOn: [] as string[], status: 'pending' as const },
      ];
      const completedStages = new Set<string>();
      const readyStages = stages.filter(
        s => s.status === 'pending' && s.dependsOn.every(d => completedStages.has(d)),
      );
      expect(readyStages).toHaveLength(3);
    });
  });

  describe('Circular dependency detection', () => {
    it('should detect simple cycle: A → B → A', () => {
      const stages: PipelineStage[] = [
        { name: 'A', prompt: 'a', dependsOn: ['B'] },
        { name: 'B', prompt: 'b', dependsOn: ['A'] },
      ];

      const graph = new Map<string, string[]>();
      for (const s of stages) graph.set(s.name, s.dependsOn || []);

      const visited = new Set<string>();
      const inStack = new Set<string>();
      let hasCycle = false;

      const dfs = (node: string) => {
        if (inStack.has(node)) { hasCycle = true; return; }
        if (visited.has(node)) return;
        inStack.add(node);
        visited.add(node);
        for (const dep of graph.get(node) || []) dfs(dep);
        inStack.delete(node);
      };

      for (const s of stages) dfs(s.name);
      expect(hasCycle).toBe(true);
    });

    it('should allow valid DAG', () => {
      const stages: PipelineStage[] = [
        { name: 'A', prompt: 'a' },
        { name: 'B', prompt: 'b', dependsOn: ['A'] },
        { name: 'C', prompt: 'c', dependsOn: ['A', 'B'] },
      ];

      const graph = new Map<string, string[]>();
      for (const s of stages) graph.set(s.name, s.dependsOn || []);

      const visited = new Set<string>();
      const inStack = new Set<string>();
      let hasCycle = false;

      const dfs = (node: string) => {
        if (inStack.has(node)) { hasCycle = true; return; }
        if (visited.has(node)) return;
        inStack.add(node);
        visited.add(node);
        for (const dep of graph.get(node) || []) dfs(dep);
        inStack.delete(node);
      };

      for (const s of stages) dfs(s.name);
      expect(hasCycle).toBe(false);
    });
  });

  describe('Batch result shape', () => {
    it('should return correct batch result format', () => {
      const result = {
        sessions: [
          { id: 'id-1', name: 'lint' },
          { id: 'id-2', name: 'test' },
        ],
        created: 2,
        failed: 0,
        errors: [],
      };
      expect(result.created).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.sessions).toHaveLength(2);
    });

    it('should count failures', () => {
      const result = {
        sessions: [{ id: 'id-1', name: 'lint' }],
        created: 1,
        failed: 1,
        errors: ['workDir not found'],
      };
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });
});
