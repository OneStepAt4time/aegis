/**
 * backend/runtime.ts — ACP Backend runtime lifecycle.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import type { AcpJsonObject, AcpJsonValue } from '../json-rpc-client.js';
import type { AcpActionRecord } from '../action-queue.js';
import type {
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionTransitionEvent,
} from '../types.js';
import type { AcpChildProcessExitEvent } from '../child-process.js';
import { StructuredLogger } from '../../../logger.js';
import {
  AcpBackendLifecycleError,
  AcpBackendRuntimeUnavailableError,
} from './errors.js';
import type {
  AcpBackendClient,
  AcpBackendClientFactoryContext,
  AcpBackendInitializeResult,
  AcpBackendRuntime,
  AcpBackendRuntimeExitEvent,
  AcpBackendSessionResult,
  AcpBackendShutdownResult,
  AcpBackendStartResult,
  AcpBackendOptions,
} from './types.js';
import {
  attachmentFromResult,
  isActiveStatus,
} from './utils.js';
import {
  activateBypassPermissions,
  neutralizeBypassPermissions,
} from '../../../permission-guard.js';

const log = new StructuredLogger();

const DEFAULT_PROTOCOL_VERSION = 1;

export interface RuntimeLifecycleDeps {
  sessionService: AcpBackendOptions['sessionService'];
  clientFactory: (context: AcpBackendClientFactoryContext) => AcpBackendClient;
  backendRunIdProvider: () => string;
  clientInfo: AcpJsonObject;
  clientCapabilities: AcpJsonObject;
  options: AcpBackendOptions;
  runtimes: Map<string, AcpBackendRuntime>;
  inFlightPrompts: Map<string, AbortController>;
  pendingApprovals: Map<string, unknown>;
}

export async function startNewRuntime(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  cwd: string,
  mcpServers: AcpJsonObject | undefined,
  systemPrompt?: string
): Promise<AcpBackendStartResult> {
  const backendRunId = deps.backendRunIdProvider();
  const runtime = await createRuntime(deps, session, cwd, backendRunId);
  let started = false;
  try {
    const initializeResult = await startAndInitialize(deps, runtime);
    started = true;
    const response = await runtime.client.request<AcpBackendSessionResult>(
      'session/new',
      buildSessionStartParams(session.id, backendRunId, cwd, mcpServers, systemPrompt)
    );
    const attachment = attachmentFromResult(response.result, backendRunId);
    const attached = await deps.sessionService.attachAgentSession(
      session.id,
      runtime.scope,
      attachment
    );
    const ready = await transitionIfInitializing(deps, attached, runtime.scope, {
      type: 'agent_ready',
    });
    runtime.agentCapabilities = initializeResult.agentCapabilities;
    deps.runtimes.set(session.id, runtime);
    return { session: ready, initializeResult, backendRunId };
  } catch (error) {
    await failStartup(deps, session.id, runtime.scope, runtime, started);
    throw error;
  }
}

export async function startNewRuntimeBackground(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  cwd: string,
  mcpServers: AcpJsonObject | undefined,
  systemPrompt: string | undefined,
  backendRunId: string
): Promise<void> {
  const runtime = await createRuntime(deps, session, cwd, backendRunId);
  let started = false;
  try {
    const initializeResult = await startAndInitialize(deps, runtime);
    started = true;
    const response = await runtime.client.request<AcpBackendSessionResult>(
      'session/new',
      buildSessionStartParams(session.id, backendRunId, cwd, mcpServers, systemPrompt)
    );
    const attachment = attachmentFromResult(response.result, backendRunId);
    const attached = await deps.sessionService.attachAgentSession(
      session.id,
      runtime.scope,
      attachment
    );
    const ready = await transitionIfInitializing(deps, attached, runtime.scope, {
      type: 'agent_ready',
    });
    runtime.agentCapabilities = initializeResult.agentCapabilities;
    deps.runtimes.set(session.id, runtime);
  } catch (error) {
    await failStartup(deps, session.id, runtime.scope, runtime, started);
  }
}

export async function startResumeRuntime(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  cwd: string,
  forcedBackendRunId?: string
): Promise<AcpBackendStartResult> {
  const acpAgentSessionId = session.acpAgentSessionId;
  if (!acpAgentSessionId) {
    throw new AcpBackendLifecycleError(
      `Cannot resume ACP session ${session.id} without ACP agent session id`
    );
  }
  const backendRunId = forcedBackendRunId ?? deps.backendRunIdProvider();
  const runtime = await createRuntime(deps, session, cwd, backendRunId);
  let started = false;
  try {
    const initializeResult = await startAndInitialize(deps, runtime);
    started = true;
    const response = await runtime.client.request<AcpBackendSessionResult>('session/resume', {
      sessionId: acpAgentSessionId,
      cwd,
      _meta: buildAegisMetadata(session.id, backendRunId),
    });
    const attachment = attachmentFromResult(response.result, backendRunId);
    const attached = await deps.sessionService.attachAgentSession(
      session.id,
      runtime.scope,
      attachment
    );
    const ready = await transitionIfInitializing(deps, attached, runtime.scope, {
      type: 'agent_ready',
    });
    runtime.agentCapabilities = initializeResult.agentCapabilities;
    deps.runtimes.set(session.id, runtime);
    return { session: ready, initializeResult, backendRunId };
  } catch (error) {
    await failStartup(deps, session.id, runtime.scope, runtime, started);
    throw error;
  }
}

export async function startLoadRuntime(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  cwd: string,
  mcpServers?: AcpJsonObject
): Promise<AcpBackendStartResult> {
  const acpAgentSessionId = session.acpAgentSessionId;
  if (!acpAgentSessionId) {
    throw new AcpBackendLifecycleError(
      `Cannot load ACP session ${session.id} without ACP agent session id`
    );
  }
  const backendRunId = deps.backendRunIdProvider();
  const runtime = await createRuntime(deps, session, cwd, backendRunId);
  let started = false;
  try {
    const initializeResult = await startAndInitialize(deps, runtime);
    started = true;
    const response = await runtime.client.request<AcpBackendSessionResult>('session/load', {
      sessionId: acpAgentSessionId,
      cwd,
      mcpServers: mcpServers ?? [],
      _meta: buildAegisMetadata(session.id, backendRunId),
    });
    const attachment = attachmentFromResult(response.result, backendRunId);
    const attached = await deps.sessionService.attachAgentSession(
      session.id,
      runtime.scope,
      attachment
    );
    const ready = await transitionIfInitializing(deps, attached, runtime.scope, {
      type: 'agent_ready',
    });
    runtime.agentCapabilities = initializeResult.agentCapabilities;
    deps.runtimes.set(session.id, runtime);
    return { session: ready, initializeResult, backendRunId };
  } catch (error) {
    await failStartup(deps, session.id, runtime.scope, runtime, started);
    throw error;
  }
}

export async function createRuntime(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  cwd: string,
  backendRunId: string
): Promise<AcpBackendRuntime> {
  // Issue #4575 P0: Apply permission-guard at the runtime boundary so
  // resume/load paths (which do NOT go through buildSessionInfo) get
  // the same settings.local.json protection as createSession. CC
  // v2.1.143 reads permissions.defaultMode from
  // <workDir>/.claude/settings.local.json on startup and OVERRIDES
  // the --permission-mode argv, so the file MUST be patched before
  // the child process spawns. This hoists the dispatch from
  // session-factory.ts:123-131 with session.permissionMode as the
  // source of truth. For new/new-background paths the call is
  // idempotent (settings already correct from buildSessionInfo);
  // for resume/load paths it closes the actual P0 gap.
  const effectivePermissionMode = session.permissionMode ?? 'default';
  if (effectivePermissionMode === 'bypassPermissions') {
    await activateBypassPermissions(cwd);
  } else {
    await neutralizeBypassPermissions(cwd, effectivePermissionMode);
  }

  const context: AcpBackendClientFactoryContext = {
    durableSessionId: session.id,
    tenantId: session.tenantId,
    ownerKeyId: session.ownerKeyId,
    backendRunId,
    cwd,
    // Issue #4522 AC #3: propagate the session's effective permission mode
    // so the AcpChildProcess can inject --permission-mode at spawn time.
    permissionMode: session.permissionMode,
  };
  return bindRuntime(deps, {
    sessionId: session.id,
    scope: { tenantId: session.tenantId, ownerKeyId: session.ownerKeyId },
    backendRunId,
    client: deps.clientFactory(context),
    disposers: [],
  });
}

export function bindRuntime(
  deps: RuntimeLifecycleDeps,
  runtime: AcpBackendRuntime
): AcpBackendRuntime {
  runtime.disposers.push(
    runtime.client.onNotification((notification) => {
      deps.options.onRawNotification?.(notification, { sessionId: runtime.sessionId, ...runtime.scope });
    }),
    runtime.client.onRequest((request) => {
      if (request.method === 'session/request_permission') {
        trackPendingApproval(deps, runtime.sessionId, request);
      }
      deps.options.onRawRequest?.(request);
    }),
    runtime.client.onExit((exit) => {
      void handleRuntimeExit(deps, runtime, exit);
    })
  );
  return runtime;
}

export async function startAndInitialize(
  deps: RuntimeLifecycleDeps,
  runtime: AcpBackendRuntime
): Promise<AcpBackendInitializeResult> {
  await runtime.client.start();
  const response = await runtime.client.request<AcpBackendInitializeResult>('initialize', {
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    clientCapabilities: deps.clientCapabilities,
    clientInfo: deps.clientInfo,
  });
  return response.result;
}

export async function failStartup(
  deps: RuntimeLifecycleDeps,
  sessionId: string,
  scope: AcpSessionScope,
  runtime: AcpBackendRuntime,
  started: boolean
): Promise<void> {
  try {
    try {
      await deps.sessionService.transition(sessionId, scope, { type: 'runtime_failed' });
    } catch (transitionError) {
      log.error({ component: 'acp-backend', operation: 'startupTransitionFailed', attributes: { sessionId, error: String(transitionError) } });
    }
  } finally {
    if (started) {
      await runtime.client.shutdown().catch(() => undefined);
    }
    disposeRuntime(deps, runtime);
    deps.runtimes.delete(sessionId);
    deps.inFlightPrompts.delete(sessionId);
  }
}

export async function shutdownRuntime(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  runtime: AcpBackendRuntime
): Promise<AcpBackendShutdownResult> {
  let current = session;
  let exit: AcpChildProcessExitEvent | undefined;
  try {
    if (isActiveStatus(current.status)) {
      current = await deps.sessionService.transition(session.id, runtime.scope, {
        type: 'close_requested',
      });
    }
    const acpAgentSessionId = current.acpAgentSessionId;
    if (acpAgentSessionId) {
      await runtime.client.request('session/close', { sessionId: acpAgentSessionId });
    }
    exit = await runtime.client.shutdown();
    if (current.status === 'closing') {
      current = await deps.sessionService.transition(session.id, runtime.scope, {
        type: 'close_completed',
      });
    } else {
      current = await deps.sessionService.getSession(session.id, runtime.scope);
    }
    return { session: current, exit };
  } finally {
    disposeRuntime(deps, runtime);
    deps.runtimes.delete(session.id);
    deps.inFlightPrompts.delete(session.id);
  }
}

export async function handleRuntimeExit(
  deps: RuntimeLifecycleDeps,
  runtime: AcpBackendRuntime,
  exit: AcpChildProcessExitEvent
): Promise<void> {
  deps.options.onRuntimeExit?.({
    sessionId: runtime.sessionId,
    backendRunId: runtime.backendRunId,
    exit,
  });
  if (exit.expected || runtime.cleanupPromise) return;
  try {
    try {
      await deps.sessionService.transition(runtime.sessionId, runtime.scope, {
        type: 'runtime_failed',
      });
    } catch (transitionError) {
      log.error({ component: 'acp-backend', operation: 'exitTransitionFailed', attributes: { sessionId: runtime.sessionId, error: String(transitionError) } });
    }
  } finally {
    disposeRuntime(deps, runtime);
    deps.runtimes.delete(runtime.sessionId);
    deps.inFlightPrompts.delete(runtime.sessionId);
  }
}

export function disposeRuntime(
  deps: RuntimeLifecycleDeps,
  runtime: AcpBackendRuntime
): void {
  for (const dispose of runtime.disposers.splice(0)) {
    dispose();
  }
  deps.pendingApprovals.delete(runtime.sessionId);
}

export function trackPendingApproval(
  deps: RuntimeLifecycleDeps,
  sessionId: string,
  request: { id: unknown; params?: unknown }
): void {
  const params =
    typeof request.params === 'object' && request.params !== null
      ? (request.params as Record<string, unknown>)
      : {};
  const toolCall =
    typeof params.toolCall === 'object' && params.toolCall !== null
      ? (params.toolCall as Record<string, unknown>)
      : {};
  deps.pendingApprovals.set(sessionId, {
    approvalId: String(request.id),
    sessionId,
    tool: {
      toolName: typeof toolCall.kind === 'string' ? toolCall.kind : 'unknown',
      description:
        typeof toolCall.title === 'string' ? toolCall.title : 'Tool execution requested',
      input:
        typeof toolCall.input === 'object' && toolCall.input !== null
          ? (toolCall.input as Record<string, unknown>)
          : undefined,
    },
    requestedAt: new Date().toISOString(),
  });
}

export async function transitionIfInitializing(
  deps: RuntimeLifecycleDeps,
  session: AcpSessionRecord,
  scope: AcpSessionScope,
  event: AcpSessionTransitionEvent
): Promise<AcpSessionRecord> {
  if (session.status !== 'initializing') return session;
  return deps.sessionService.transition(session.id, scope, event);
}

export function buildSessionStartParams(
  durableSessionId: string,
  backendRunId: string,
  cwd: string,
  mcpServers: AcpJsonObject | undefined,
  systemPrompt?: string
): AcpJsonObject {
  return {
    cwd,
    mcpServers: mcpServers ?? [],
    _meta: {
      ...buildAegisMetadata(durableSessionId, backendRunId),
      ...(systemPrompt ? { systemPrompt } : {}),
    },
  };
}

export function buildAegisMetadata(durableSessionId: string, backendRunId: string): AcpJsonObject {
  return {
    aegis: {
      sessionId: durableSessionId,
      backendRunId,
    },
  };
}
