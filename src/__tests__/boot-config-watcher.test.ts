/**
 * Tests for boot/boot-config-watcher.ts — extracted config watcher setup and reload handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupConfigWatcherImpl, handleConfigReloadImpl } from '../boot/boot-config-watcher.js';

// Mock config module
vi.mock('../config.js', () => ({
  findConfigFilePath: vi.fn(),
  reloadAllowedWorkDirs: vi.fn(),
}));

// Mock node:fs to avoid real filesystem access
vi.mock('node:fs', () => ({
  watch: vi.fn(),
}));

import { findConfigFilePath, reloadAllowedWorkDirs } from '../config.js';
import { watch } from 'node:fs';

const mockFindConfigFilePath = vi.mocked(findConfigFilePath);
const mockReloadAllowedWorkDirs = vi.mocked(reloadAllowedWorkDirs);
const mockWatch = vi.mocked(watch);

function makeMockWatcher() {
  const onCallbacks: Record<string, (...args: any[]) => void> = {};
  const watcher = {
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      onCallbacks[event] = cb;
      return watcher;
    }),
    close: vi.fn(),
  };
  return { watcher, onCallbacks };
}

function makeCtx() {
  return {
    watchedConfigPath: null as string | null,
    configWatcher: null as any,
    configReloadTimer: null as any,
    config: { allowedWorkDirs: ['/original'] },
  } as any;
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  } as any;
}

function makeTimers() {
  return {
    setTimeout: vi.fn((fn: () => void, _ms: number) => 'timer-id'),
    clearTimeout: vi.fn(),
  } as any;
}

describe('setupConfigWatcherImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when no config file found', () => {
    mockFindConfigFilePath.mockReturnValue(null);
    const ctx = makeCtx();
    const logger = makeLogger();
    const timers = makeTimers();

    setupConfigWatcherImpl(ctx, logger, timers);

    expect(ctx.watchedConfigPath).toBeNull();
    expect(ctx.configWatcher).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it('sets up watcher and stores config path when config file exists', () => {
    const { watcher } = makeMockWatcher();
    mockWatch.mockReturnValue(watcher as any);
    mockFindConfigFilePath.mockReturnValue('/etc/aegis/config.json');
    const ctx = makeCtx();
    const logger = makeLogger();
    const timers = makeTimers();

    setupConfigWatcherImpl(ctx, logger, timers);

    expect(ctx.watchedConfigPath).toBe('/etc/aegis/config.json');
    expect(ctx.configWatcher).toBe(watcher);
    expect(mockWatch).toHaveBeenCalledWith('/etc/aegis/config.json', expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'config_watcher_started',
        attributes: { configPath: '/etc/aegis/config.json' },
      }),
    );
  });

  it('debounces file changes: clears old timer then sets new one', () => {
    const { watcher, onCallbacks } = makeMockWatcher();
    mockWatch.mockReturnValue(watcher as any);
    mockFindConfigFilePath.mockReturnValue('/etc/aegis/config.json');
    const ctx = makeCtx();
    ctx.configReloadTimer = 'old-timer';
    const logger = makeLogger();
    const timers = makeTimers();

    setupConfigWatcherImpl(ctx, logger, timers);

    // Get the watch callback and fire it
    const watchCallback = mockWatch.mock.calls[0][1] as (eventType: string) => void;
    watchCallback('change');

    expect(timers.clearTimeout).toHaveBeenCalledWith('old-timer');
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 300);
    expect(ctx.configReloadTimer).toBe('timer-id');
  });

  it('closes watcher on error event', () => {
    const { watcher, onCallbacks } = makeMockWatcher();
    mockWatch.mockReturnValue(watcher as any);
    mockFindConfigFilePath.mockReturnValue('/etc/aegis/config.json');
    const ctx = makeCtx();
    const logger = makeLogger();
    const timers = makeTimers();

    setupConfigWatcherImpl(ctx, logger, timers);

    // Fire the error handler
    onCallbacks['error'](new Error('watch error'));

    expect(watcher.close).toHaveBeenCalled();
    expect(ctx.configWatcher).toBeNull();
  });

  it('handles watch() throwing by catching gracefully', () => {
    mockWatch.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFindConfigFilePath.mockReturnValue('/nonexistent/config.json');
    const ctx = makeCtx();
    const logger = makeLogger();
    const timers = makeTimers();

    // Should not throw
    expect(() => setupConfigWatcherImpl(ctx, logger, timers)).not.toThrow();
    expect(ctx.configWatcher).toBeNull();
  });
});

describe('handleConfigReloadImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when reloadAllowedWorkDirs returns null', async () => {
    mockReloadAllowedWorkDirs.mockResolvedValue(null);
    const ctx = makeCtx();
    ctx.watchedConfigPath = '/etc/aegis/config.json';
    const logger = makeLogger();

    await handleConfigReloadImpl('SIGHUP', ctx, logger);

    expect(ctx.config.allowedWorkDirs).toEqual(['/original']);
  });

  it('updates allowedWorkDirs when config changes', async () => {
    mockReloadAllowedWorkDirs.mockResolvedValue(['/new-dir-1', '/new-dir-2']);
    const ctx = makeCtx();
    ctx.watchedConfigPath = '/etc/aegis/config.json';
    const logger = makeLogger();

    await handleConfigReloadImpl('file-change', ctx, logger);

    expect(ctx.config.allowedWorkDirs).toEqual(['/new-dir-1', '/new-dir-2']);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'config_hot_reload',
        attributes: expect.objectContaining({ source: 'file-change', count: 2 }),
      }),
    );
  });

  it('does not update when dirs are unchanged', async () => {
    mockReloadAllowedWorkDirs.mockResolvedValue(['/original']);
    const ctx = makeCtx();
    ctx.watchedConfigPath = '/etc/aegis/config.json';
    const logger = makeLogger();

    await handleConfigReloadImpl('SIGHUP', ctx, logger);

    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs warning on reload error', async () => {
    mockReloadAllowedWorkDirs.mockRejectedValue(new Error('read error'));
    const ctx = makeCtx();
    ctx.watchedConfigPath = '/etc/aegis/config.json';
    const logger = makeLogger();

    await handleConfigReloadImpl('SIGHUP', ctx, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'config_hot_reload_failed',
        attributes: expect.objectContaining({ source: 'SIGHUP' }),
      }),
    );
  });
});
