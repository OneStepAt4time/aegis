/**
 * multi-cli-runner-factory.test.ts — Phase 3.6 / ADR-0034.
 * Tests resolveRunnerChildProcessOptions: the client factory merges the
 * per-session AcpRunnerProfile (resolved from context.runnerName) into the
 * AcpChildProcess spawn options. Claude Code default is behavior-preserving;
 * Kimi selects `kimi acp` + KIMI_/MOONSHOT_ auth + no-argv permission strategy.
 */
import { describe, expect, it } from 'vitest';

import { resolveRunnerChildProcessOptions } from '../services/acp/backend/utils.js';
import { AcpRunnerProfileError } from '../services/acp/runner-profile.js';
import type {
  ResolvedAcpCommand,
  ResolveAcpCommandOptions,
} from '../services/acp/binary-resolver.js';

const baseContext = {
  durableSessionId: 'sess-1',
  backendRunId: 'run-1',
  cwd: '/tmp',
  tenantId: 'tenant',
  ownerKeyId: 'key',
};

describe('resolveRunnerChildProcessOptions — factory profile wiring', () => {
  it('defaults to the Claude Code profile (behavior-preserving)', () => {
    const opts = resolveRunnerChildProcessOptions(undefined, baseContext);
    expect(opts.permissionModeStrategy).toBe('claude-code-argv');
    expect(opts.authEnvPrefixes).toEqual(['ANTHROPIC_', 'CLAUDE_']);
    // CC resolver honors AEGIS_ACP_BIN — proves it is resolveClaudeAgentAcpBinary.
    const resolved = opts.resolveCommand!({ env: { AEGIS_ACP_BIN: '/fake/cc' } });
    expect(resolved.command).toBe('/fake/cc');
  });

  it('resolves the Kimi profile when runnerName is "kimi"', () => {
    const opts = resolveRunnerChildProcessOptions(undefined, { ...baseContext, runnerName: 'kimi' });
    expect(opts.permissionModeStrategy).toBe('none');
    expect(opts.authEnvPrefixes).toEqual(['KIMI_', 'MOONSHOT_']);
    const resolved = opts.resolveCommand!({ env: {} });
    expect(resolved.command).toBe('kimi');
    expect(resolved.args).toEqual(['acp']);
  });

  it('base childProcessOptions override the profile resolveCommand', () => {
    const customResolver = (_options: ResolveAcpCommandOptions): ResolvedAcpCommand => ({
      command: '/custom',
      args: ['x'],
      source: 'explicit',
    });
    const opts = resolveRunnerChildProcessOptions(
      { resolveCommand: customResolver },
      { ...baseContext, runnerName: 'kimi' }
    );
    expect(opts.resolveCommand).toBe(customResolver);
  });

  it('permissionMode: base wins over context; context fills when base absent', () => {
    const fromContext = resolveRunnerChildProcessOptions(undefined, {
      ...baseContext,
      permissionMode: 'acceptEdits',
    });
    expect(fromContext.permissionMode).toBe('acceptEdits');
    const baseWins = resolveRunnerChildProcessOptions(
      { permissionMode: 'plan' },
      { ...baseContext, permissionMode: 'acceptEdits' }
    );
    expect(baseWins.permissionMode).toBe('plan');
  });

  it('throws AcpRunnerProfileError for an unknown runner', () => {
    expect(() =>
      resolveRunnerChildProcessOptions(undefined, { ...baseContext, runnerName: 'nope' })
    ).toThrow(AcpRunnerProfileError);
  });
});
