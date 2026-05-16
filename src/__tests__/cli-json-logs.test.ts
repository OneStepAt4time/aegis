/**
 * cli-json-logs.test.ts — Tests for --json-logs flag and startup hint (Issue #3528).
 *
 * Covers PR #3519 follow-up: --json-logs CLI flag, setJsonLogsEnabled(),
 * quietSink behavior, and printBanner() output.
 *
 * Tests real function calls with captured output — no nominal tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setJsonLogsEnabled,
  isJsonLogsEnabled,
  setStructuredLogSink,
  StructuredLogger,
  type StructuredLogSink,
  type StructuredLogRecord,
} from '../logger.js';
import { printBanner } from '../cli.js';
import type { CliIO } from '../cli.js';

// ---------------------------------------------------------------------------
// Helper: capture console output during tests
// ---------------------------------------------------------------------------
function captureConsole(): { stdout: string[]; stderr: string[]; restore: () => void } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...args: any[]) => stdout.push(args.map(String).join(' '));
  console.warn = (...args: any[]) => stderr.push(args.map(String).join(' '));
  console.error = (...args: any[]) => stderr.push(args.map(String).join(' '));
  return {
    stdout,
    stderr,
    restore: () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origErr;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('--json-logs flag and logger toggle', () => {
  beforeEach(() => {
    setJsonLogsEnabled(false);
  });

  it('defaults to false (quiet mode)', () => {
    expect(isJsonLogsEnabled()).toBe(false);
  });

  it('setJsonLogsEnabled(true) enables JSON log output', () => {
    setJsonLogsEnabled(true);
    expect(isJsonLogsEnabled()).toBe(true);
  });

  it('setJsonLogsEnabled(false) disables JSON log output', () => {
    setJsonLogsEnabled(true);
    expect(isJsonLogsEnabled()).toBe(true);
    setJsonLogsEnabled(false);
    expect(isJsonLogsEnabled()).toBe(false);
  });

  it('toggles correctly multiple times', () => {
    setJsonLogsEnabled(true);
    expect(isJsonLogsEnabled()).toBe(true);
    setJsonLogsEnabled(false);
    expect(isJsonLogsEnabled()).toBe(false);
    setJsonLogsEnabled(true);
    expect(isJsonLogsEnabled()).toBe(true);
    setJsonLogsEnabled(false);
    expect(isJsonLogsEnabled()).toBe(false);
  });
});

describe('quietSink vs defaultSink behavior', () => {
  let captured: { stdout: string[]; stderr: string[]; restore: () => void };

  beforeEach(() => {
    setJsonLogsEnabled(false);
    captured = captureConsole();
  });

  afterEach(() => {
    captured.restore();
  });

  it('quiet mode: info log produces no stdout output', () => {
    const log = new StructuredLogger();
    log.info({ component: 'test', operation: 'quiet-info' });
    // quietSink discards info — nothing on stdout
    expect(captured.stdout).toHaveLength(0);
  });

  it('quiet mode: warn log produces no stderr output', () => {
    const log = new StructuredLogger();
    log.warn({ component: 'test', operation: 'quiet-warn' });
    // quietSink discards warn — nothing on stderr
    expect(captured.stderr).toHaveLength(0);
  });

  it('quiet mode: error log still emits to stderr', () => {
    const log = new StructuredLogger();
    log.error({ component: 'test', operation: 'quiet-error' });
    // quietSink keeps error — one line on stderr
    expect(captured.stderr).toHaveLength(1);
    const parsed = JSON.parse(captured.stderr[0]);
    expect(parsed.level).toBe('error');
    expect(parsed.component).toBe('test');
    expect(parsed.operation).toBe('quiet-error');
  });

  it('json-logs enabled: info log emits JSON to stdout', () => {
    setJsonLogsEnabled(true);
    const log = new StructuredLogger();
    log.info({ component: 'test', operation: 'json-info' });
    expect(captured.stdout).toHaveLength(1);
    const parsed = JSON.parse(captured.stdout[0]);
    expect(parsed.level).toBe('info');
    expect(parsed.component).toBe('test');
  });

  it('json-logs enabled: warn log emits JSON to stderr', () => {
    setJsonLogsEnabled(true);
    const log = new StructuredLogger();
    log.warn({ component: 'test', operation: 'json-warn' });
    expect(captured.stderr).toHaveLength(1);
    const parsed = JSON.parse(captured.stderr[0]);
    expect(parsed.level).toBe('warn');
  });

  it('switching from quiet to json-logs immediately enables output', () => {
    // Start in quiet mode
    const log = new StructuredLogger();
    log.info({ component: 'test', operation: 'before-toggle' });
    expect(captured.stdout).toHaveLength(0);

    // Toggle on
    setJsonLogsEnabled(true);
    log.info({ component: 'test', operation: 'after-toggle' });
    expect(captured.stdout).toHaveLength(1);
    const parsed = JSON.parse(captured.stdout[0]);
    expect(parsed.operation).toBe('after-toggle');
  });
});

describe('setStructuredLogSink override', () => {
  let captured: { stdout: string[]; stderr: string[]; restore: () => void };

  beforeEach(() => {
    setJsonLogsEnabled(false);
    captured = captureConsole();
  });

  afterEach(() => {
    // Reset to default sink
    setJsonLogsEnabled(false);
    captured.restore();
  });

  it('custom sink receives all log levels', () => {
    const records: StructuredLogRecord[] = [];
    const customSink: StructuredLogSink = {
      info: (r) => records.push(r),
      warn: (r) => records.push(r),
      error: (r) => records.push(r),
    };
    setStructuredLogSink(customSink);

    const log = new StructuredLogger();
    log.info({ component: 'test', operation: 'custom-info' });
    log.warn({ component: 'test', operation: 'custom-warn' });
    log.error({ component: 'test', operation: 'custom-error' });

    expect(records).toHaveLength(3);
    expect(records[0].level).toBe('info');
    expect(records[1].level).toBe('warn');
    expect(records[2].level).toBe('error');
  });
});

describe('printBanner output', () => {
  let output: string[];

  function mockIO(): CliIO & { output: string[] } {
    const chunks: string[] = [];
    return {
      stdin: process.stdin,
      stdout: { write: (text: string) => { chunks.push(text); return true; } } as any,
      stderr: process.stderr,
      output: chunks,
    };
  }

  it('includes dashboard URL with host and port', () => {
    const io = mockIO();
    printBanner(io, 9100, 'localhost');
    const joined = io.output.join('');
    expect(joined).toContain('http://localhost:9100/dashboard/');
  });

  it('includes ag create suggestion', () => {
    const io = mockIO();
    printBanner(io, 9100, 'localhost');
    const joined = io.output.join('');
    expect(joined).toContain("ag create 'Build a hello world'");
  });

  it('includes Telegram setup hint', () => {
    const io = mockIO();
    printBanner(io, 9100, 'localhost');
    const joined = io.output.join('');
    expect(joined).toContain('ag telegram');
  });

  it('uses custom host and port', () => {
    const io = mockIO();
    printBanner(io, 8080, '0.0.0.0');
    const joined = io.output.join('');
    expect(joined).toContain('http://0.0.0.0:8080/dashboard/');
    expect(joined).not.toContain('localhost');
  });

  it('includes Aegis version in banner box', () => {
    const io = mockIO();
    printBanner(io, 9100, 'localhost');
    const joined = io.output.join('');
    expect(joined).toContain('Aegis v');
    expect(joined).toContain('Claude Code Session Bridge');
  });
});
