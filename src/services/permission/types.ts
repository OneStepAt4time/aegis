export type { PermissionProfile } from '../../validation.js';

export interface PermissionEvaluationInput {
  toolName: string;
  toolInput?: Record<string, unknown>;
}

export interface PermissionEvaluationResult {
  behavior: 'allow' | 'deny' | 'ask';
  reason: string;
}
