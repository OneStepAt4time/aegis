/**
 * config-watcher.ts — Config file hot-reload via fs.watch and SIGHUP.
 *
 * Extracted from server.ts as part of #4243 decomposition.
 * Only allowedWorkDirs is hot-reloaded; other config changes require a restart.
 */

import { watch, type FSWatcher } from 'node:fs';
import { findConfigFilePath, reloadAllowedWorkDirs } from '../../config.js';
import type { AppContext } from '../../app-context.js';
import type { StructuredLogger } from '../../logger.js';
import timers from 'node:timers';

interface ConfigWatcherDeps {
  logger: StructuredLogger;
}

/**
 * Set up fs.watch on the active config file and a SIGHUP handler for manual reload.
 */
export function setupConfigWatcher(
  ctx: AppContext,
  deps: ConfigWatcherDeps,
): void {
  const { logger } = deps;
  const configPath = findConfigFilePath();
  if (!configPath) return;
  ctx.watchedConfigPath = configPath;

  process.on('SIGHUP', () => {
    void handleConfigReload('SIGHUP', ctx, deps);
  });

  try {
    ctx.configWatcher = watch(configPath, () => {
      if (ctx.configReloadTimer) timers.clearTimeout(ctx.configReloadTimer);
      ctx.configReloadTimer = timers.setTimeout(() => {
        void handleConfigReload('file-change', ctx, deps);
      }, 300);
    });
    ctx.configWatcher.on('error', () => {
      ctx.configWatcher?.close();
      ctx.configWatcher = null;
    });
    logger.info({
      component: 'server',
      operation: 'config_watcher_started',
      attributes: { configPath },
    });
  } catch {
    // watch() can throw if file is inaccessible — skip gracefully
  }
}

/**
 * Reload allowedWorkDirs from config file and update the live config object.
 */
export async function handleConfigReload(
  source: string,
  ctx: AppContext,
  deps: ConfigWatcherDeps,
): Promise<void> {
  const { logger } = deps;
  try {
    const newDirs = await reloadAllowedWorkDirs(ctx.watchedConfigPath ?? undefined);
    if (newDirs === null) return;
    const oldDirs = ctx.config.allowedWorkDirs;
    const changed = newDirs.length !== oldDirs.length
      || newDirs.some((d, i) => d !== oldDirs[i]);
    if (changed) {
      ctx.config.allowedWorkDirs = newDirs;
      logger.info({
        component: 'server',
        operation: 'config_hot_reload',
        attributes: { source, field: 'allowedWorkDirs', count: newDirs.length },
      });
    }
  } catch (e) {
    logger.warn({
      component: 'server',
      operation: 'config_hot_reload_failed',
      attributes: { source, error: e instanceof Error ? e.message : String(e) },
    });
  }
}
