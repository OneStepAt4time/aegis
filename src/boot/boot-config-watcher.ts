// boot/boot-config-watcher.ts — extracted config watcher and reload handler

import { watch } from 'node:fs';
import { reloadAllowedWorkDirs, findConfigFilePath } from '../config.js';
import type { AppContext } from '../app-context.js';

export function setupConfigWatcherImpl(ctx: AppContext, logger: any, timers: any): void {
  const configPath = findConfigFilePath();
  if (!configPath) return;
  ctx.watchedConfigPath = configPath;

  process.on('SIGHUP', () => {
    void handleConfigReloadImpl('SIGHUP', ctx, logger);
  });

  try {
    ctx.configWatcher = watch(configPath, (_eventType) => {
      if (ctx.configReloadTimer) timers.clearTimeout(ctx.configReloadTimer);
      ctx.configReloadTimer = timers.setTimeout(() => {
        void handleConfigReloadImpl('file-change', ctx, logger);
      }, 300);
    });
    ctx.configWatcher.on('error', () => {
      ctx.configWatcher?.close();
      ctx.configWatcher = null;
    });
    logger.info({ component: 'server', operation: 'config_watcher_started', attributes: { configPath } });
  } catch {
    // watch() can throw if file is inaccessible — just skip
  }
}


export async function handleConfigReloadImpl(source: string, ctx: AppContext, logger: any): Promise<void> {
  try {
    const newDirs = await reloadAllowedWorkDirs(ctx.watchedConfigPath ?? undefined);
    if (newDirs === null) return;
    const oldDirs = ctx.config.allowedWorkDirs;
    const changed = newDirs.length !== oldDirs.length || newDirs.some((d, i) => d !== oldDirs[i]);
    if (changed) {
      ctx.config.allowedWorkDirs = newDirs;
      logger.info({ component: 'server', operation: 'config_hot_reload', attributes: { source, field: 'allowedWorkDirs', count: newDirs.length } });
    }
  } catch (e) {
    logger.warn({ component: 'server', operation: 'config_hot_reload_failed', attributes: { source, error: e instanceof Error ? e.message : String(e) } });
  }
}
