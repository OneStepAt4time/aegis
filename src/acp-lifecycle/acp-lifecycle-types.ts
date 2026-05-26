/**
 * Types, constants, and interfaces for the ACP lifecycle probe.
 * Extracted from acp-lifecycle-probe.ts for maintainability (#4235 step 1).
 *
 * Security audit (2026-05-26): Redis EVAL usage review — not applicable here;
 * this file contains only type declarations and static constants.
 */

import {
  type ResolvedAcpCommand,
} from '../services/acp/binary-resolver.js';

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 15_000;
export const EXIT_TIMEOUT_MS = 2_000;
export const STDERR_LIMIT_BYTES = 64 * 1024;
export const APPROVAL_STRING_LIMIT_BYTES = 2 * 1024;
export const APPROVAL_ARRAY_LIMIT_ITEMS = 25;
export const APPROVAL_OBJECT_LIMIT_KEYS = 50;
export const APPROVAL_WRITE_EXIT_GRACE_MS = 100;

export const REDACTED_ACP_VALUE = '[REDACTED]';

// ── Shared types ─────────────────────────────────────────────────────────────

export type AcpModelProvider =
  | 'anthropic'
  | 'glm'
  | 'openrouter'
  | 'lm-studio'
  | 'ollama'
  | 'azure-openai';

export type AcpPermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';
export type AcpApprovalState = 'pending' | 'responded' | 'rejected';
export type AcpApprovalRejectionReason =
  | 'child_exit'
  | 'request_timeout'
  | 'transport_disposed'
  | 'write_failed';

export type Platform = NodeJS.Platform;
export type JsonObject = Record<string, unknown>;
export type JsonRpcId = number | string | null;

// ── Public interfaces ────────────────────────────────────────────────────────

export interface AcpAgentInfo {
  name: string;
  title?: string;
  version?: string;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities: JsonObject;
  agentInfo: AcpAgentInfo;
  authMethods: unknown[];
}

export interface AcpNewSessionResult {
  sessionId: string;
}

export interface AcpPromptResult {
  stopReason: string;
}

export interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: number;
  result: T;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: JsonObject;
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export interface AcpApprovalToolCall {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: unknown;
  content?: unknown;
}

export interface AcpSelectedApprovalOutcome {
  outcome: 'selected';
  optionId: string;
}

export interface AcpCancelledApprovalOutcome {
  outcome: 'cancelled';
}

export type AcpApprovalOutcome = AcpSelectedApprovalOutcome | AcpCancelledApprovalOutcome;

export interface AcpApprovalResponse {
  outcome: AcpApprovalOutcome;
}

export type AcpApprovalDecision =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'selected'; optionKind: AcpPermissionOptionKind }
  | { outcome: 'cancelled' };

export interface AcpApprovalRequest {
  requestId: JsonRpcId;
  sessionId: string;
  toolCall: AcpApprovalToolCall;
  options: AcpPermissionOption[];
  state: AcpApprovalState;
  response?: AcpApprovalResponse;
  rejectionReason?: AcpApprovalRejectionReason;
}

export interface AcpLifecycleProbeOptions {
  resolvedCommand?: ResolvedAcpCommand;
  command?: string;
  args?: readonly string[];
  cwd: string;
  sessionCwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  prompt?: string;
  model?: string;
  modelProvider?: string;
  providerEnv?: Record<string, string | undefined>;
  resumeSession?: boolean;
  closeSession?: boolean;
  cancelAfterFirstUpdate?: boolean;
  cancelAfterApprovalRequest?: boolean;
  approvalDecision?: AcpApprovalDecision | ((request: AcpApprovalRequest) => AcpApprovalDecision);
  clientCapabilities?: JsonObject;
}

export interface AcpModelPassthroughSummary {
  provider?: AcpModelProvider;
  model?: string;
  env: Record<string, string>;
  envKeys: string[];
}

export interface AcpLifecycleProbeResult {
  command: ResolvedAcpCommand;
  initialize: JsonRpcSuccess<AcpInitializeResult>;
  newSession: JsonRpcSuccess<AcpNewSessionResult>;
  sessionId: string;
  resume?: JsonRpcSuccess<JsonObject>;
  prompt?: JsonRpcSuccess<AcpPromptResult>;
  close?: JsonRpcSuccess<JsonObject>;
  frames: import('../acp-event-stream.js').AcpCapturedFrame[];
  normalizedEvents: import('../acp-event-stream.js').AcpNormalizedEvent[];
  notifications: JsonRpcNotification[];
  approvalRequests: AcpApprovalRequest[];
  stderr: string;
  modelPassthrough: AcpModelPassthroughSummary;
  cancelSent: boolean;
  exit: {
    code: number | null;
    signal: NodeJS.Signals | null;
  };
}

// ── Internal interfaces ──────────────────────────────────────────────────────

export interface PendingRequest {
  method: string;
  resolve: (message: JsonRpcSuccess<unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AcpModelPassthrough {
  summary: AcpModelPassthroughSummary;
  env: Record<string, string>;
  sessionMeta?: JsonObject;
  sensitiveValues: string[];
}

export interface PendingApprovalRequest {
  request: AcpApprovalRequest;
  rawSessionId: string;
  responseOptions: AcpPermissionOption[];
}

export interface NormalizedApprovalRequest {
  request: AcpApprovalRequest;
  rawSessionId: string;
  responseOptions: AcpPermissionOption[];
}

export interface ApprovalHandlingOptions {
  cancelAfterApprovalRequest?: boolean;
  decision?: AcpApprovalDecision | ((request: AcpApprovalRequest) => AcpApprovalDecision);
}

// ── Error class ──────────────────────────────────────────────────────────────

export class AcpProtocolError extends Error {
  readonly details: JsonObject;

  constructor(message: string, details: JsonObject = {}) {
    super(message);
    this.name = 'AcpProtocolError';
    this.details = details;
  }
}
