/**
 * hook-settings.test.ts — Tests for Issue #169 Phase 2: HTTP hook settings injection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateHookSettings,
  writeHookSettingsFile,
  cleanupHookSettingsFile,
  HTTP_HOOK_EVENTS,
  type HookSettings,
} from '../hook-settings.js';

describe('generateHookSettings', () => {
  const baseUrl = 'http://localhost:9100';
  const sessionId = 'abc123-def456-ghi789';

  it('should generate settings with all registered HTTP hook events', () => {
    const settings = generateHookSettings(baseUrl, sessionId);

    expect(Object.keys(settings.hooks)).toHaveLength(HTTP_HOOK_EVENTS.length);
    for (const event of HTTP_HOOK_EVENTS) {
      expect(settings.hooks[event]).toBeDefined();
      expect(Array.isArray(settings.hooks[event])).toBe(true);
    }
  });

  it('should generate correct URL format for each event', () => {
    const settings = generateHookSettings(baseUrl, sessionId);

    for (const event of HTTP_HOOK_EVENTS) {
      const entry = settings.hooks[event]![0];
      const hook = entry.hooks[0];

      expect(hook.type).toBe('http');
      expect(hook.url).toBe(`${baseUrl}/v1/hooks/${event}?sessionId=${sessionId}`);
    }
  });

  it('should include all 13 registered HTTP hook events', () => {
    const settings = generateHookSettings(baseUrl, sessionId);
    const events = Object.keys(settings.hooks);

    expect(events).toContain('Stop');
    expect(events).toContain('PreToolUse');
    expect(events).toContain('PostToolUse');
    expect(events).toContain('PostToolUseFailure');
    expect(events).toContain('PermissionRequest');
    expect(events).toContain('TaskCompleted');
    expect(events).toContain('SessionStart');
    expect(events).toContain('SessionEnd');
    expect(events).toContain('UserPromptSubmit');
    expect(events).toContain('SubagentStart');
    expect(events).toContain('SubagentStop');
    expect(events).toContain('Notification');
    expect(events).toContain('TeammateIdle');
    expect(events.length).toBe(13);
  });

  it('should produce valid JSON structure', () => {
    const settings = generateHookSettings(baseUrl, sessionId);

    // Should serialize and deserialize cleanly
    const json = JSON.stringify(settings);
    const parsed: HookSettings = JSON.parse(json);

    expect(parsed.hooks).toBeDefined();
    expect(typeof parsed.hooks).toBe('object');
  });

  it('should use the provided baseUrl and sessionId', () => {
    const customBase = 'http://192.168.1.100:8080';
    const customSession = 'my-session-id';

    const settings = generateHookSettings(customBase, customSession);
    const stopHook = settings.hooks.Stop![0].hooks[0];

    expect(stopHook.url).toBe('http://192.168.1.100:8080/v1/hooks/Stop?sessionId=my-session-id');
  });

  it('should include Stop event', () => {
    const settings = generateHookSettings(baseUrl, sessionId);
    expect(settings.hooks.Stop).toBeDefined();
  });

  it('should include PreToolUse event', () => {
    const settings = generateHookSettings(baseUrl, sessionId);
    expect(settings.hooks.PreToolUse).toBeDefined();
  });

  it('should include PostToolUse event', () => {
    const settings = generateHookSettings(baseUrl, sessionId);
    expect(settings.hooks.PostToolUse).toBeDefined();
  });

  it('should include PermissionRequest event', () => {
    const settings = generateHookSettings(baseUrl, sessionId);
    expect(settings.hooks.PermissionRequest).toBeDefined();
  });

  it('should include TaskCompleted event', () => {
    const settings = generateHookSettings(baseUrl, sessionId);
    expect(settings.hooks.TaskCompleted).toBeDefined();
  });
});

describe('writeHookSettingsFile', () => {
  const testDir = join(tmpdir(), 'aegis-hooks-test-' + process.pid);
  const originalTmpdir = tmpdir;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should write a valid JSON settings file', async () => {
    const filePath = await writeHookSettingsFile('http://localhost:9100', 'test-session');

    try {
      expect(existsSync(filePath)).toBe(true);

      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed: HookSettings = JSON.parse(content);

      expect(parsed.hooks).toBeDefined();
      expect(Object.keys(parsed.hooks).length).toBeGreaterThan(0);
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should include the session ID in the filename', async () => {
    const sessionId = 'unique-session-abc';
    const filePath = await writeHookSettingsFile('http://localhost:9100', sessionId);

    try {
      expect(filePath).toContain(sessionId);
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should produce URLs matching the provided base URL', async () => {
    const baseUrl = 'http://example.com:3000';
    const filePath = await writeHookSettingsFile(baseUrl, 'session-1');

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed: HookSettings = JSON.parse(content);

      for (const event of HTTP_HOOK_EVENTS) {
        const hook = parsed.hooks[event]![0].hooks[0];
        expect(hook.url).toContain(baseUrl);
      }
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });
});

describe('cleanupHookSettingsFile', () => {
  it('should remove an existing settings file', async () => {
    const filePath = await writeHookSettingsFile('http://localhost:9100', 'cleanup-test');
    expect(existsSync(filePath)).toBe(true);

    await cleanupHookSettingsFile(filePath);
    expect(existsSync(filePath)).toBe(false);
  });

  it('should not throw for a non-existent file', async () => {
    await expect(cleanupHookSettingsFile('/tmp/nonexistent-aegis-hooks-file.json')).resolves.not.toThrow();
  });
});

describe('writeHookSettingsFile — Issue #339 merge', () => {
  const workDir = join(tmpdir(), 'aegis-test-workdir-' + process.pid);
  const claudeDir = join(workDir, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');

  beforeEach(() => {
    mkdirSync(claudeDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('should merge hooks into project settings.local.json', async () => {
    const projectSettings = {
      permissions: { defaultMode: 'bypassPermissions' },
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-test-123', ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
    };
    writeFileSync(settingsPath, JSON.stringify(projectSettings, null, 2));

    const filePath = await writeHookSettingsFile('http://localhost:9100', 'merge-test', workDir);

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // Project settings preserved
      expect(parsed.permissions).toEqual({ defaultMode: 'bypassPermissions' });
      expect(parsed.env).toEqual({ ANTHROPIC_AUTH_TOKEN: 'sk-test-123', ANTHROPIC_BASE_URL: 'https://proxy.example.com' });

      // Hooks also present
      expect(parsed.hooks).toBeDefined();
      const hooks = parsed.hooks as Record<string, unknown>;
      expect(hooks.Stop).toBeDefined();
      expect(hooks.PreToolUse).toBeDefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should work without workDir (backwards compatible)', async () => {
    const filePath = await writeHookSettingsFile('http://localhost:9100', 'no-workdir');

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      expect(parsed.hooks).toBeDefined();
      // No project-level keys leaked in
      expect(parsed.permissions).toBeUndefined();
      expect(parsed.env).toBeUndefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should handle missing settings.local.json gracefully', async () => {
    // Don't write settings.local.json — directory exists but file doesn't
    const filePath = await writeHookSettingsFile('http://localhost:9100', 'missing-settings', workDir);

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // Should still have hooks
      expect(parsed.hooks).toBeDefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should handle malformed settings.local.json gracefully', async () => {
    writeFileSync(settingsPath, 'not valid json {{{');

    const filePath = await writeHookSettingsFile('http://localhost:9100', 'malformed', workDir);

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // Should still have hooks, no crash
      expect(parsed.hooks).toBeDefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should override project hooks with Aegis hooks', async () => {
    const projectSettings = {
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo old' }] }],
      },
      env: { FOO: 'bar' },
    };
    writeFileSync(settingsPath, JSON.stringify(projectSettings, null, 2));

    const filePath = await writeHookSettingsFile('http://localhost:9100', 'override-test', workDir);

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // env preserved
      expect(parsed.env).toEqual({ FOO: 'bar' });
      // Stop hook overridden by Aegis
      const hooks = parsed.hooks as Record<string, Array<{ hooks: Array<{ type: string; url: string }> }>>;
      const stopHook = hooks.Stop![0].hooks[0];
      expect(stopHook.type).toBe('http');
      expect(stopHook.url).toContain('localhost:9100');
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  it('should preserve non-conflicting project hooks alongside Aegis hooks', async () => {
    const projectSettings = {
      hooks: {
        CustomEvent: [{ hooks: [{ type: 'command', command: 'echo custom' }] }],
      },
    };
    writeFileSync(settingsPath, JSON.stringify(projectSettings, null, 2));

    const filePath = await writeHookSettingsFile('http://localhost:9100', 'preserve-test', workDir);

    try {
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const hooks = parsed.hooks as Record<string, unknown>;

      // CustomEvent preserved from project
      expect(hooks.CustomEvent).toBeDefined();
      // Aegis hooks also present
      expect(hooks.Stop).toBeDefined();
      expect(hooks.PreToolUse).toBeDefined();
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });
});
