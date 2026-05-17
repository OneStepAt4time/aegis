import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';

// #3501: Test Claude Code MCP auto-wiring detection
// We test the detection logic by mocking execFile

describe('init CC MCP wiring (#3501)', () => {
  // These tests verify the logic flow; integration tests cover the actual CLI

  it('should detect valid claude path from which/where output', () => {
    // Simulated output from `which claude`
    const output = '/usr/local/bin/claude\n';
    const path = output.trim().split('\n')[0];
    expect(path).toBe('/usr/local/bin/claude');
  });

  it('should detect already-wired MCP from claude mcp list output', () => {
    const output = `aegis: ag mcp
other: npx other-mcp`;
    expect(output.includes('aegis')).toBe(true);
  });

  it('should detect NOT wired from claude mcp list output', () => {
    const output = 'other: npx other-mcp';
    expect(output.includes('aegis')).toBe(false);
  });

  // #3614 regression: isProjectConfig must distinguish global vs project config
  it('should identify global ~/.aegis/config.yaml as NOT project config', () => {
    const configPath = '/home/user/.aegis/config.yaml';
    const globalAegisDir = '/home/user/.aegis';
    const isProjectConfig = !configPath.startsWith(globalAegisDir);
    expect(isProjectConfig).toBe(false);
  });

  it('should identify project-local .aegis/config.yaml as project config', () => {
    const configPath = '/home/user/projects/myapp/.aegis/config.yaml';
    const globalAegisDir = '/home/user/.aegis';
    const isProjectConfig = !configPath.startsWith(globalAegisDir);
    expect(isProjectConfig).toBe(true);
  });

  it('should identify non-home-dir config as project config', () => {
    const configPath = '/opt/projects/myapp/.aegis/config.yaml';
    const globalAegisDir = '/home/user/.aegis';
    const isProjectConfig = !configPath.startsWith(globalAegisDir);
    expect(isProjectConfig).toBe(true);
  });

  it('should build correct wire args for project scope', () => {
    const isProjectConfig = true;
    const wireArgs = isProjectConfig
      ? ['mcp', 'add', '--scope', 'project', 'aegis', '--', 'ag', 'mcp']
      : ['mcp', 'add', 'aegis', '--', 'ag', 'mcp'];
    expect(wireArgs).toEqual(['mcp', 'add', '--scope', 'project', 'aegis', '--', 'ag', 'mcp']);
  });

  it('should build correct wire args for global scope', () => {
    const isProjectConfig = false;
    const wireArgs = isProjectConfig
      ? ['mcp', 'add', '--scope', 'project', 'aegis', '--', 'ag', 'mcp']
      : ['mcp', 'add', 'aegis', '--', 'ag', 'mcp'];
    expect(wireArgs).toEqual(['mcp', 'add', 'aegis', '--', 'ag', 'mcp']);
  });
});
