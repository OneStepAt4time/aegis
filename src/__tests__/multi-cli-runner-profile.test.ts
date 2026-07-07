/**
 * multi-cli-runner-profile.test.ts — Contract tests for AcpRunnerProfile.
 *
 * Phase 3.6 / ADR-0034: per-runner spawn configuration so AcpBackend can host
 * any ACP-speaking CLI (Claude Code default, Kimi Code) behind the same
 * JSON-RPC machinery. The profile owns binary resolution, auth env prefixes,
 * the permission-mode strategy, and the CC-specific guard flags.
 */
import { describe, expect, it } from 'vitest';

import {
  CLAUDE_CODE_RUNNER,
  KIMI_RUNNER,
  resolveAcpRunnerProfile,
  AcpRunnerProfileError,
} from '../services/acp/runner-profile.js';
import { resolveClaudeAgentAcpBinary } from '../services/acp/binary-resolver.js';

describe('AcpRunnerProfile — Phase 3.6 multi-CLI', () => {
  describe('resolveAcpRunnerProfile', () => {
    it('defaults to the Claude Code profile when name is undefined', () => {
      const profile = resolveAcpRunnerProfile(undefined);
      expect(profile.name).toBe(CLAUDE_CODE_RUNNER);
    });

    it('defaults to the Claude Code profile when name is empty', () => {
      const profile = resolveAcpRunnerProfile('  ');
      expect(profile.name).toBe(CLAUDE_CODE_RUNNER);
    });

    it('throws AcpRunnerProfileError for an unknown runner', () => {
      try {
        resolveAcpRunnerProfile('definitely-not-a-runner');
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(AcpRunnerProfileError);
        expect((err as AcpRunnerProfileError).code).toBe('AEGIS_ACP_RUNNER_UNKNOWN');
      }
    });
  });

  describe('Claude Code profile (reference, behavior-preserving)', () => {
    const profile = resolveAcpRunnerProfile(CLAUDE_CODE_RUNNER);

    it('uses the existing claude-agent-acp binary resolver', () => {
      // Same resolver function — guarantees no behavior change for CC sessions.
      expect(profile.resolveCommand).toBe(resolveClaudeAgentAcpBinary);
    });

    it('authenticates through ANTHROPIC_* / CLAUDE_* env passthrough', () => {
      expect(profile.envPrefixes).toContain('ANTHROPIC_');
      expect(profile.envPrefixes).toContain('CLAUDE_');
    });

    it('uses the Claude Code --permission-mode argv strategy', () => {
      expect(profile.permissionModeStrategy).toBe('claude-code-argv');
    });

    it('enables all CC-specific guards', () => {
      expect(profile.guards.patchClaudeSettings).toBe(true);
      expect(profile.guards.parseClaudeTranscript).toBe(true);
      expect(profile.guards.claudeAgentsDiscovery).toBe(true);
    });
  });

  describe('Kimi Code profile (native ACP, MIT)', () => {
    const profile = resolveAcpRunnerProfile(KIMI_RUNNER);

    it('resolves the kimi binary with the `acp` subcommand', () => {
      const resolved = profile.resolveCommand({ env: {} });
      expect(resolved.command).toBe('kimi');
      expect(resolved.args).toEqual(['acp']);
    });

    it('honors AEGIS_KIMI_BIN override for the binary path', () => {
      const resolved = profile.resolveCommand({ env: { AEGIS_KIMI_BIN: '/custom/kimi' } });
      expect(resolved.command).toBe('/custom/kimi');
      expect(resolved.args).toEqual(['acp']);
    });

    it('honors an explicit command override', () => {
      const resolved = profile.resolveCommand({
        env: {},
        explicitCommand: '/opt/kimi-code/bin/kimi',
      });
      expect(resolved.command).toBe('/opt/kimi-code/bin/kimi');
      expect(resolved.args).toEqual(['acp']);
    });

    it('authenticates through KIMI_* / MOONSHOT_* env passthrough', () => {
      expect(profile.envPrefixes).toContain('KIMI_');
      expect(profile.envPrefixes).toContain('MOONSHOT_');
    });

    it('does NOT use the Claude Code --permission-mode argv strategy', () => {
      // Kimi governs permissions via ACP session/request_permission +
      // setSessionMode, not a CLI flag injected by Aegis.
      expect(profile.permissionModeStrategy).not.toBe('claude-code-argv');
    });

    it('disables all CC-specific guards (ACP-event-store-only mode)', () => {
      expect(profile.guards.patchClaudeSettings).toBe(false);
      expect(profile.guards.parseClaudeTranscript).toBe(false);
      expect(profile.guards.claudeAgentsDiscovery).toBe(false);
    });
  });
});
