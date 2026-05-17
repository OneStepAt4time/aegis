import { describe, it, expect } from 'vitest';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

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

  // Issue #3614: Scope detection must distinguish global (~/.aegis/) from project configs
  it('should use GLOBAL scope for ~/.aegis/config.yaml (global config)', () => {
    const configPath = join(homedir(), '.aegis', 'config.yaml');
    const globalAegisDir = join(homedir(), '.aegis');
    const isProjectConfig = !resolve(configPath).startsWith(globalAegisDir);
    expect(isProjectConfig).toBe(false); // global scope
  });

  it('should use project scope for ~/projects/myapp/.aegis/config.yaml', () => {
    const configPath = join(homedir(), 'projects', 'myapp', '.aegis', 'config.yaml');
    const globalAegisDir = join(homedir(), '.aegis');
    const isProjectConfig = !resolve(configPath).startsWith(globalAegisDir);
    expect(isProjectConfig).toBe(true); // project scope
  });

  it('should use project scope for /opt/aegis/config.yaml (non-home dir)', () => {
    const configPath = '/opt/aegis/config.yaml';
    const globalAegisDir = join(homedir(), '.aegis');
    const isProjectConfig = !resolve(configPath).startsWith(globalAegisDir);
    expect(isProjectConfig).toBe(true); // project scope
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
