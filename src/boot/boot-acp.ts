/**
 * boot-acp.ts — ACP initialization and service registration.
 *
 * Extracted from server.ts as part of #4243 (god object reduction).
 * Contains bootAcp() for ACP local profile, session service, backend,
 * and terminal bridge initialization, plus registerAcpServices() for
 * ServiceContainer wiring.
 */

import path from 'node:path';

import { SYSTEM_TENANT } from '../config.js';
import { logger } from '../logger.js';
import { ServiceContainer } from '../container.js';
import type { AppContext } from '../app-context.js';
import { AcpBackend } from '../services/acp/backend.js';
import { AcpSessionService } from '../services/acp/session-service.js';
import { AcpTerminalBridge } from '../services/acp/terminal-bridge.js';
import { createFileAcpLocalStorageProfile } from '../services/acp/local-storage.js';
import { InMemoryPauseInterventionStore } from '../services/acp/in-memory-pause-intervention-store.js';
import { mapAcpJsonRpcNotificationToEvent } from '../services/acp/event-mapper.js';

/**
 * Initialize ACP local storage profile, session service, backend,
 * and terminal bridge. Populates ctx.acp* fields.
 */
export async function bootAcp(ctx: AppContext): Promise<void> {
  // Issue #2607 / ACP-064: Initialize ACP local storage profile and backend
  // Issue #4032: Allow test override of persist debounce via env var.
  const persistDebounceMs = process.env.AEGIS_PERSIST_DEBOUNCE_MS
    ? parseInt(process.env.AEGIS_PERSIST_DEBOUNCE_MS, 10)
    : undefined;
  ctx.acpLocalProfile = createFileAcpLocalStorageProfile({
    filePath: path.join(ctx.config.stateDir, 'acp-local-storage.json'),
    ...(persistDebounceMs !== undefined ? { persistDebounceMs } : {}),
  });
  await ctx.acpLocalProfile.start();
  ctx.acpPauseStore = ctx.acpLocalProfile!.pauseInterventionStore ?? null;
  ctx.acpSessionService = new AcpSessionService(ctx.acpLocalProfile!.sessionStore, {
    pauseInterventionStore: ctx.acpPauseStore ?? new InMemoryPauseInterventionStore(),
  });
  // Issue #3422: Wire ACP notifications to event store so /read and /transcript
  // return data for ACP sessions. Without this, CC notifications are received but never persisted.
  const acpEventStore = ctx.acpLocalProfile!.eventStore;
  ctx.acpBackend = new AcpBackend({
    sessionService: ctx.acpSessionService!,
    jsonRpcClientOptions: { requestTimeoutMs: ctx.config.acpPromptTimeoutMs },
    onRawNotification: (notification, context) => {
      try {
        const event = mapAcpJsonRpcNotificationToEvent(notification, {
          sessionId: context.sessionId,
          tenantId: context.tenantId,
          ownerKeyId: context.ownerKeyId,
        });
        void acpEventStore.append(event).catch(err => {
          logger.info({
            component: 'server',
            operation: 'acp_event_append_failed',
            attributes: { sessionId: context.sessionId, error: String(err) },
          });
        });
      } catch (err) {
        logger.info({
          component: 'server',
          operation: 'acp_event_map_failed',
          attributes: { sessionId: context.sessionId, error: String(err) },
        });
      }
    },
  });
  ctx.acpTerminalBridge = new AcpTerminalBridge({
    sessionResolver: {
      getSession: (sessionId, scope) => ctx.acpSessionService!.getSession(sessionId, scope),
    },
    runtimeResolver: {
      getRuntime: (sessionId) => {
        const runtime = ctx.acpBackend!.getRuntime(sessionId);
        if (!runtime) return null;
        return { client: runtime.client, agentCapabilities: runtime.agentCapabilities };
      },
    },
  });
}

/**
 * Register ACP-related services in the ServiceContainer.
 */
export function registerAcpServices(container: ServiceContainer, ctx: AppContext): void {
  container.register('acpLocalProfile', ctx.acpLocalProfile!, {
    start: async () => {
      await ctx.acpLocalProfile!.start();
    },
    stop: async (signal) => {
      await ctx.acpLocalProfile!.stop(signal);
    },
    health: async () => ctx.acpLocalProfile!.health(),
  });
  container.register('acpBackend', ctx.acpBackend!, {
    start: async () => {},
    stop: async () => {
      // Gracefully shutdown all active ACP runtimes
      if (ctx.acpBackend) {
        const promises: Promise<unknown>[] = [];
        for (const session of ctx.sessions.listSessions()) {
          promises.push(
            ctx.acpBackend!.shutdownSession({ sessionId: session.id, tenantId: session.tenantId ?? SYSTEM_TENANT, ownerKeyId: session.ownerKeyId ?? 'master' })
              .catch(() => {})
          );
        }
        await Promise.all(promises);
      }
    },
    health: async () => ({ healthy: true }),
  }, ['acpLocalProfile']);
}
