import { describe, expect, it, vi } from 'vitest';

import { getConfig } from '../config.js';
import {
  buildDoctorBaseUrl,
  evaluatePortCheck,
  formatDoctorReport,
  parseDoctorArgs,
  parseTmuxVersion,
  runDoctorChecks,
  runDoctorCommand,
  type DoctorBaseUrlResult,
  type DoctorCheck,
  type DoctorCommandResult,
  type DoctorConfigContext,
  type DoctorDependencies,
} from '../doctor.js';

function makeCommandResult(overrides: Partial<DoctorCommandResult> = {}): DoctorCommandResult {
  return {
    ok: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    notFound: false,
    ...overrides,
  };
}

function makeConfigContext(overrides: Partial<DoctorConfigContext> = {}): DoctorConfigContext {
  return {
    config: {
      ...getConfig(),
      host: '127.0.0.1',
      port: 9100,
      stateDir: 'C:\\state',
    },
    configPath: null,
    check: {
      key: 'config',
      label: 'Config',
      status: 'ok',
      message: 'Using defaults and environment overrides',
    },
    ...overrides,
  };
}

function makeFetch(result: DoctorBaseUrlResult): typeof fetch {
  return vi.fn(async () => {
    if (!result.ok) {
      throw new Error(result.error ?? 'boom');
    }

    return new Response(
      JSON.stringify({
        status: result.healthStatus ?? 'ok',
        version: '0.5.3-alpha',
      }),
      {
        status: result.statusCode ?? 200,
        statusText: result.statusText ?? 'OK',
        headers: {
          'content-type': 'application/json',
          'x-aegis-api-version': '1',
        },
      },
    );
  }) as unknown as typeof fetch;
}

function makeDependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  const runCommand = vi.fn(async (command: string, args: string[]) => {
    if (command === 'tmux' && args[0] === '-V') {
      return makeCommandResult({ stdout: 'tmux 3.4' });
    }
    if (command === 'claude' && args[0] === '--version') {
      return makeCommandResult({ stdout: '2.1.111 (Claude Code)' });
    }
    if (command === 'claude' && args[0] === 'auth') {
      return makeCommandResult({ stdout: '{"authenticated":true}' });
    }
    return makeCommandResult({ ok: false, error: 'unexpected command' });
  });

  return {
    runCommand,
    readConfigContext: vi.fn(async () => makeConfigContext()),
    fetch: makeFetch({ ok: true, healthStatus: 'ok' }),
    findPidOnPort: vi.fn(async () => [4242]),
    probeStateDirWriteAccess: vi.fn(async () => ({ ok: true, created: false })),
    verifyAuditChain: vi.fn(async () => ({ valid: true, fileCount: 1 })),
    ...overrides,
  };
}

describe('ag doctor', () => {
  describe('argument parsing', () => {
    it('parses --json and --port flags', () => {
      expect(parseDoctorArgs(['--json', '--port', '9300'])).toEqual({
        json: true,
        portArg: '9300',
      });
    });

    it('ignores missing port values', () => {
      expect(parseDoctorArgs(['--port'])).toEqual({
        json: false,
        portArg: undefined,
      });
    });
  });

  describe('version and URL helpers', () => {
    it('parses tmux 3.2 as a supported semver', () => {
      expect(parseTmuxVersion('tmux 3.2')).toBe('3.2.0');
    });

    it('normalizes wildcard hosts for reachability probes', () => {
      expect(buildDoctorBaseUrl('0.0.0.0', 9100)).toBe('http://127.0.0.1:9100');
      expect(buildDoctorBaseUrl('::', 9100)).toBe('http://[::1]:9100');
    });
  });

  describe('port evaluation', () => {
    it('treats a free port as healthy when Aegis is down', () => {
      expect(evaluatePortCheck(9100, [], false)).toMatchObject({
        status: 'ok',
        message: '9100 is free for Aegis to bind',
      });
    });

    it('fails when another process owns the port', () => {
      expect(evaluatePortCheck(9100, [11, 12], false)).toMatchObject({
        status: 'fail',
        message: '9100 is occupied by PIDs 11, 12',
      });
    });
  });

  describe('runDoctorChecks()', () => {
    it('returns ok when all checks pass', async () => {
      const report = await runDoctorChecks({ json: false }, makeDependencies());

      expect(report.ok).toBe(true);
      expect(report.summary.failed).toBe(0);
      expect(report.baseUrl).toBe('http://127.0.0.1:9100');
      expect(report.checks.map(check => check.label)).toEqual([
        'Config',
        'Node.js',
        'tmux',
        'Claude CLI',
        'Claude auth',
        'State dir',
        'Port',
        'Base URL',
        'Audit chain',
      ]);
    });

    it('fails when the base URL is unreachable even if the port is free', async () => {
      const report = await runDoctorChecks(
        { json: false },
        makeDependencies({
          fetch: makeFetch({ ok: false, error: 'connect ECONNREFUSED' }),
          findPidOnPort: vi.fn(async () => []),
        }),
      );

      expect(report.ok).toBe(false);
      expect(report.summary.failed).toBe(1);
      expect(report.checks.find(check => check.key === 'port')?.status).toBe('ok');
      expect(report.checks.find(check => check.key === 'base-url')).toMatchObject({
        status: 'fail',
      });
    });

    it('fails when audit verification finds a broken chain', async () => {
      const report = await runDoctorChecks(
        { json: false },
        makeDependencies({
          verifyAuditChain: vi.fn(async () => ({
            valid: false,
            file: 'audit-2026-04-17.log',
            brokenAt: 7,
            fileCount: 1,
          })),
        }),
      );

      expect(report.ok).toBe(false);
      expect(report.checks.find(check => check.key === 'audit-chain')).toMatchObject({
        status: 'fail',
        message: 'invalid at audit-2026-04-17.log line 7',
      });
    });
  });

  describe('output formatting', () => {
    it('formats a readable text report', () => {
      const checks: DoctorCheck[] = [
        { key: 'node', label: 'Node.js', status: 'ok', message: 'v22.0.0' },
        { key: 'base-url', label: 'Base URL', status: 'fail', message: 'unreachable' },
      ];

      const output = formatDoctorReport({
        ok: false,
        timestamp: '2026-04-17T20:00:00.000Z',
        baseUrl: 'http://127.0.0.1:9100',
        configPath: null,
        stateDir: 'C:\\state',
        auditDir: 'C:\\state\\audit',
        summary: { total: 2, passed: 1, warnings: 0, failed: 1 },
        checks,
      });

      expect(output).toContain('Aegis doctor');
      expect(output).toContain('✅ Node.js');
      expect(output).toContain('❌ Base URL');
      expect(output).toContain('1 check failed.');
    });

    it('emits JSON when requested', async () => {
      const logs: string[] = [];
      const exitCode = await runDoctorCommand(
        ['--json'],
        {
          log: (...args: unknown[]) => {
            logs.push(args.join(' '));
          },
          error: vi.fn(),
        },
        makeDependencies({
          fetch: makeFetch({ ok: false, error: 'connect ECONNREFUSED' }),
          findPidOnPort: vi.fn(async () => []),
        }),
      );

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(logs[0]!);
      expect(parsed.ok).toBe(false);
      expect(parsed.summary.failed).toBe(1);
      expect(parsed.checks.some((check: DoctorCheck) => check.key === 'base-url')).toBe(true);
    });
  });
});
