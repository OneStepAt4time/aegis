/**
 * boot-services.ts — ServiceContainer registration for managed services.
 *
 * Extracted from server.ts (#4243 step 6): registers sessionManager,
 * authManager, channelManager, and sessionMonitor with lifecycle hooks
 * (start/stop/health) in the ServiceContainer.
 *
 * Issue #3356/#3484/#3567: Auth token auto-repair logic lives in the
 * authManager start hook to keep it co-located with auth initialization.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { ServiceContainer } from '../container.js';
import type { AppContext } from '../app-context.js';
import type { ChannelManager } from '../channels/index.js';
import { getAuthTokenFilePath, persistAuthTokenFile } from '../utils/auth-token-path.js';
import { StructuredLogger } from '../logger.js';

const log = new StructuredLogger();

export interface ServiceRegistrationDeps {
  ctx: AppContext;
  channels: ChannelManager;
  handleInbound: (cmd: any) => Promise<void>;
}

/**
 * Register core services with the ServiceContainer.
 * Services are started/stopped in dependency order by the container.
 */
export function registerCoreServices(
  container: ServiceContainer,
  deps: ServiceRegistrationDeps,
): void {
  const { ctx, channels, handleInbound } = deps;

  container.register('sessionManager', ctx.sessions, {
    start: async () => {
      await ctx.sessions.load();
      ctx.sessions.startCleanupTimer(); // Issue #4124
    },
    stop: async () => {
      ctx.sessions.stopCleanupTimer(); // Issue #4124
      await ctx.sessions.save();
    },
    health: async () => ({ healthy: true, details: `sessions=${ctx.sessions.listSessions().length}` }),
  }, []);

  container.register('authManager', ctx.auth, {
    start: async () => {
      await ctx.auth.load();
      // #3356/#3484/#3567: Detect and auto-repair an orphaned ~/.aegis/auth-token
      // whose content no longer matches any registered key. Auto-repair by
      // persisting the current master token so the CLI keeps working after restarts.
      const clientTokenFile = getAuthTokenFilePath();
      const currentMaster = ctx.auth.getMasterToken();
      if (currentMaster) {
        try {
          const fileToken = existsSync(clientTokenFile)
            ? readFileSync(clientTokenFile, 'utf-8').trim()
            : '';
          if (!fileToken || !ctx.auth.checkClientToken(fileToken).matched) {
            persistAuthTokenFile(currentMaster);
            if (fileToken) {
              log.warn({
                component: 'server',
                operation: 'authTokenDesyncRepaired',
                attributes: { file: clientTokenFile },
              });
            }
          }
        } catch {
          // Unreadable — try to persist anyway
          persistAuthTokenFile(currentMaster);
        }
      }
    },
    stop: async () => {},
    health: async () => ({ healthy: ctx.auth.isHealthy(), details: ctx.auth.isHealthy() ? undefined : "keys.json missing — state dir may have been wiped" }),
  });

  container.register('channelManager', channels, {
    start: async () => {
      await channels.init(deps.handleInbound);
    },
    stop: async () => {
      await channels.destroy();
    },
    health: async () => ({ healthy: true, details: `channels=${channels.count}` }),
  }, ['sessionManager']);

  container.register('sessionMonitor', ctx.monitor, {
    start: async () => {
      ctx.monitor.start();
    },
    stop: async () => {
      ctx.monitor.stop();
    },
    health: async () => ({
      healthy: ctx.monitor.isRunning,
      details: ctx.monitor.isRunning ? 'running' : 'not running',
    }),
  }, ['sessionManager', 'channelManager']);
}
