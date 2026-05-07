/**
 * Regression test for #2820: MCP server must not leak non-protocol data to stdout.
 *
 * Claude Code <2.1.132 had a critical memory leak: MCP servers writing non-protocol
 * data to stdout caused CC process RSS to balloon to 10GB+. This test ensures:
 *
 * 1. The MCP server redirects console.log to stderr (defense-in-depth)
 * 2. Running `ag mcp` with an initialize request produces ONLY valid JSON-RPC on stdout
 * 3. Any console.log calls during MCP operation go to stderr, not stdout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const CLI_PATH = resolve(__dirname, '../../dist/cli.js');

/**
 * Send an MCP initialize request via stdin and capture stdout lines.
 * Returns parsed JSON-RPC responses from stdout.
 */
function spawnMcpAndInitialize(): Promise<{
  stdoutLines: string[];
  stderrOutput: string;
  child: ChildProcess;
}> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('MCP spawn timed out after 10s'));
    }, 10_000);

    const child = spawn('node', [CLI_PATH, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const stdoutLines: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) stdoutLines.push(line);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // Send initialize request
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      },
    });

    // Wait a moment for the server to start, then send the request
    setTimeout(() => {
      child.stdin?.write(initRequest + '\n');

      // Wait for response, then kill
      setTimeout(() => {
        child.kill();
        clearTimeout(timeout);
        resolve({
          stdoutLines,
          stderrOutput: stderrChunks.join(''),
          child,
        });
      }, 2000);
    }, 1000);
  });
}

describe('MCP stdout leak prevention (#2820)', () => {
  describe('redirectConsoleLogToStderr', () => {
    it('should redirect console.log output to stderr', async () => {
      const { redirectConsoleLogToStderr } = await import('../mcp/server.js');

      const originalLog = console.log;
      const stderrChunks: string[] = [];
      const originalStderrWrite = process.stderr.write.bind(process.stderr);

      process.stderr.write = (chunk: unknown, ...rest: unknown[]): boolean => {
        if (typeof chunk === 'string') {
          stderrChunks.push(chunk);
        }
        return (originalStderrWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
      };

      try {
        redirectConsoleLogToStderr();
        console.log('This should go to stderr, not stdout');

        expect(stderrChunks).toHaveLength(1);
        expect(stderrChunks[0]).toContain('This should go to stderr, not stdout');
      } finally {
        console.log = originalLog;
        process.stderr.write = originalStderrWrite;
      }
    });

    it('should handle multiple arguments', async () => {
      const { redirectConsoleLogToStderr } = await import('../mcp/server.js');

      const originalLog = console.log;
      const stderrChunks: string[] = [];
      const originalStderrWrite = process.stderr.write.bind(process.stderr);

      process.stderr.write = (chunk: unknown, ...rest: unknown[]): boolean => {
        if (typeof chunk === 'string') {
          stderrChunks.push(chunk);
        }
        return (originalStderrWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
      };

      try {
        redirectConsoleLogToStderr();
        console.log('prefix', 42, { key: 'value' });

        expect(stderrChunks).toHaveLength(1);
        expect(stderrChunks[0]).toContain('prefix 42');
      } finally {
        console.log = originalLog;
        process.stderr.write = originalStderrWrite;
      }
    });
  });

  describe('MCP process stdout output', () => {
    it('should produce only valid JSON-RPC on stdout', async () => {
      const { stdoutLines } = await spawnMcpAndInitialize();

      expect(stdoutLines.length).toBeGreaterThan(0);

      for (const line of stdoutLines) {
        // Every stdout line must be valid JSON
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          expect.fail(`Non-JSON output on MCP stdout: ${line}`);
        }

        // Every JSON output must be a valid JSON-RPC 2.0 message
        expect(parsed).toHaveProperty('jsonrpc', '2.0');
      }
    });

    it('should include a valid initialize response', async () => {
      const { stdoutLines } = await spawnMcpAndInitialize();

      const initResponse = stdoutLines
        .map((l) => JSON.parse(l))
        .find((m) => m.id === 1);

      expect(initResponse).toBeDefined();
      expect(initResponse.result).toBeDefined();
      expect(initResponse.result.serverInfo.name).toBe('aegis');
      expect(initResponse.result.protocolVersion).toBe('2024-11-05');
    });
  });
});
