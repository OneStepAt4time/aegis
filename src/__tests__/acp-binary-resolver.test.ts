import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AcpBinaryResolutionError,
  resolveClaudeAgentAcpBinary,
} from '../services/acp/binary-resolver.js';

const packageName = '@agentclientprotocol/claude-agent-acp';
const binName = 'claude-agent-acp';

describe('ACP binary resolver', () => {
  it('uses AEGIS_ACP_BIN before inspecting the bundled dependency', () => {
    let packageJsonResolved = false;

    const resolved = resolveClaudeAgentAcpBinary({
      env: { AEGIS_ACP_BIN: '/opt/acp/custom-agent' },
      resolvePackageJsonPath: () => {
        packageJsonResolved = true;
        return '/repo/node_modules/@agentclientprotocol/claude-agent-acp/package.json';
      },
    });

    expect(resolved).toEqual({
      command: '/opt/acp/custom-agent',
      args: [],
      source: 'AEGIS_ACP_BIN',
      binName,
      packageName,
    });
    expect(packageJsonResolved).toBe(false);
  });

  it('resolves the bundled package bin through node for cross-platform spawning', () => {
    const packageJsonPath = path.win32.join(
      'D:\\aegis',
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'package.json'
    );
    const binPath = path.win32.join(
      'D:\\aegis',
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'dist',
      'index.js'
    );

    const resolved = resolveClaudeAgentAcpBinary({
      env: { Path: 'D:\\node\\bin' },
      platform: 'win32',
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
      resolvePackageJsonPath: () => packageJsonPath,
      readPackageJson: () => ({
        name: packageName,
        bin: { [binName]: 'dist/index.js' },
      }),
      fileExists: candidate => candidate === binPath,
    });

    expect(resolved).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [binPath],
      source: 'bundled-package-bin',
      binName,
      binPath,
      packageName,
      packageJsonPath,
    });
  });

  it('supports package bin metadata expressed as a string', () => {
    const packageJsonPath = path.posix.join(
      '/repo',
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'package.json'
    );
    const binPath = path.posix.join(
      '/repo',
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'dist',
      'index.js'
    );

    const resolved = resolveClaudeAgentAcpBinary({
      platform: 'linux',
      nodeExecPath: '/usr/bin/node',
      resolvePackageJsonPath: () => packageJsonPath,
      readPackageJson: () => ({
        name: packageName,
        bin: 'dist/index.js',
      }),
      fileExists: candidate => candidate === binPath,
    });

    expect(resolved.command).toBe('/usr/bin/node');
    expect(resolved.args).toEqual([binPath]);
    expect(resolved.source).toBe('bundled-package-bin');
  });

  it('resolves the installed dependency by default without spawning a process', () => {
    const resolved = resolveClaudeAgentAcpBinary({ env: {} });

    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args).toHaveLength(1);
    expect(resolved.args[0]).toContain(
      path.join('node_modules', '@agentclientprotocol', 'claude-agent-acp')
    );
    expect(resolved.source).toBe('bundled-package-bin');
    expect(resolved.binName).toBe(binName);
    expect(resolved.packageName).toBe(packageName);
  });

  it('throws a structured missing-binary error when the dependency bin cannot be found', () => {
    const packageJsonPath = path.posix.join(
      '/repo',
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'package.json'
    );
    const binPath = path.posix.join(
      '/repo',
      'node_modules',
      '@agentclientprotocol',
      'claude-agent-acp',
      'dist',
      'index.js'
    );

    expect(() =>
      resolveClaudeAgentAcpBinary({
        env: { PATH: '/usr/local/bin' },
        platform: 'linux',
        nodeExecPath: '/usr/bin/node',
        resolvePackageJsonPath: () => packageJsonPath,
        readPackageJson: () => ({
          name: packageName,
          bin: { [binName]: 'dist/index.js' },
        }),
        fileExists: () => false,
      })
    ).toThrow(AcpBinaryResolutionError);

    try {
      resolveClaudeAgentAcpBinary({
        platform: 'linux',
        nodeExecPath: '/usr/bin/node',
        resolvePackageJsonPath: () => packageJsonPath,
        readPackageJson: () => ({
          name: packageName,
          bin: { [binName]: 'dist/index.js' },
        }),
        fileExists: () => false,
      });
      throw new Error('expected resolver to throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AcpBinaryResolutionError);
      expect(error).toMatchObject({
        name: 'AcpBinaryResolutionError',
        code: 'AEGIS_ACP_BINARY_NOT_FOUND',
        details: {
          attemptedPaths: [binPath],
          binName,
          envVar: 'AEGIS_ACP_BIN',
          packageJsonPath,
          packageName,
        },
      });
    }
  });
});

import {
  filterCustomArgs,
  resolveBlockedFlags,
  DEFAULT_BLOCKED_ACP_FLAGS,
} from '../services/acp/binary-resolver.js';

describe('filterCustomArgs', () => {
  const blocked = ['--output-format', '--resume', '--session-id', '--api-key', '--model'];

  it('strips a blocked flag with a separate value', () => {
    const result = filterCustomArgs(
      ['--verbose', '--api-key', 'secret123', '--model', 'gpt-4'],
      blocked
    );
    expect(result).toEqual(['--verbose']);
  });

  it('strips a blocked flag with =value syntax', () => {
    const result = filterCustomArgs(
      ['--output-format=json', '--resume=sess-abc', '--debug'],
      blocked
    );
    expect(result).toEqual(['--debug']);
  });

  it('passes through non-blocked args', () => {
    const result = filterCustomArgs(
      ['--verbose', '--debug', '--some-custom-flag', 'value'],
      blocked
    );
    expect(result).toEqual(['--verbose', '--debug', '--some-custom-flag', 'value']);
  });

  it('handles empty args array', () => {
    expect(filterCustomArgs([], blocked)).toEqual([]);
  });

  it('handles empty blocked list (nothing filtered)', () => {
    const result = filterCustomArgs(['--api-key', 'secret'], []);
    expect(result).toEqual(['--api-key', 'secret']);
  });

  it('strips all blocked flags leaving only safe args', () => {
    const result = filterCustomArgs(
      ['--verbose', '--api-key', 'k', '--model', 'm', '--debug', '--output-format', 'json'],
      blocked
    );
    expect(result).toEqual(['--verbose', '--debug']);
  });

  it('does not strip --verbose or --debug (safe user-facing flags)', () => {
    const result = filterCustomArgs(
      ['--verbose', '--debug', '--api-key', 'secret'],
      blocked
    );
    expect(result).toEqual(['--verbose', '--debug']);
  });

  it('handles blocked flag at end of args without value', () => {
    const result = filterCustomArgs(
      ['--verbose', '--api-key'],
      blocked
    );
    expect(result).toEqual(['--verbose']);
  });

  it('handles consecutive blocked flags', () => {
    const result = filterCustomArgs(
      ['--model', 'gpt-4', '--api-key', 'k', '--verbose'],
      blocked
    );
    expect(result).toEqual(['--verbose']);
  });
});

describe('resolveBlockedFlags', () => {
  it('returns default blocked flags when env var is not set', () => {
    expect(resolveBlockedFlags({})).toEqual(DEFAULT_BLOCKED_ACP_FLAGS);
  });

  it('returns default blocked flags when env var is empty string', () => {
    expect(resolveBlockedFlags({ AEGIS_BLOCKED_ACP_ARGS: '' })).toEqual(DEFAULT_BLOCKED_ACP_FLAGS);
  });

  it('returns default blocked flags when env var is whitespace', () => {
    expect(resolveBlockedFlags({ AEGIS_BLOCKED_ACP_ARGS: '   ' })).toEqual(DEFAULT_BLOCKED_ACP_FLAGS);
  });

  it('parses comma-separated env var as custom block list', () => {
    expect(resolveBlockedFlags({ AEGIS_BLOCKED_ACP_ARGS: '--foo,--bar' })).toEqual(['--foo', '--bar']);
  });

  it('trims whitespace from comma-separated flags', () => {
    expect(resolveBlockedFlags({ AEGIS_BLOCKED_ACP_ARGS: ' --foo , --bar ' })).toEqual(['--foo', '--bar']);
  });

  it('filters out empty entries from comma-separated list', () => {
    expect(resolveBlockedFlags({ AEGIS_BLOCKED_ACP_ARGS: '--foo,,--bar,' })).toEqual(['--foo', '--bar']);
  });
});
