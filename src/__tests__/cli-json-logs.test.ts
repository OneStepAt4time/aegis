import { describe, it, expect, vi } from 'vitest';
import { setJsonLogsEnabled, isJsonLogsEnabled, StructuredLogger } from '../logger.js';

describe('CLI --json-logs', () => {
  it('enables structured info logs when setJsonLogsEnabled(true) is called', () => {
    // Spy on console.log / console.error
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Initially disabled
      setJsonLogsEnabled(false);
      const logger = new StructuredLogger();
      logger.info({ component: 'test', operation: 'op' });
      expect(logSpy).not.toHaveBeenCalled();

      // Enable JSON logs
      setJsonLogsEnabled(true);
      expect(isJsonLogsEnabled()).toBe(true);
      logger.info({ component: 'test', operation: 'op2' });
      expect(logSpy).toHaveBeenCalled();

      // Warn and error also use sinks
      logger.warn({ component: 'test', operation: 'warn' });
      logger.error({ component: 'test', operation: 'err' });
      expect(errSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
