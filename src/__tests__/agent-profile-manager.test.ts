/**
 * AgentProfileManager tests — Issue #3971
 *
 * Covers: CRUD, name validation, env denylist, configHash,
 * archive/restore, persistence, security (Themis audit).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import JsonAgentStore from "../services/agents/JsonAgentStore.js";
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentProfileManager, AgentProfileNotFoundError, AgentProfileArchivedError, AgentProfileNameError, AgentProfileEnvError } from '../services/agents/AgentProfileManager.js';

describe('AgentProfileManager', () => {
  let dataDir: string;
  let manager: AgentProfileManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'aegis-profile-test-'));
    const store = new JsonAgentStore(dataDir);
    manager = new AgentProfileManager(store);
    await manager.load();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  // ── Create ────────────────────────────────────────────────────

  it('creates a profile with defaults', async () => {
    const profile = await manager.create(null, 'key-1', { name: 'test-agent' });

    expect(profile.id).toBeDefined();
    expect(profile.agentId).toBeDefined();
    expect(profile.workspaceId).toBeNull();
    expect(profile.name).toBe('test-agent');
    expect(profile.description).toBeNull();
    expect(profile.runtimeMode).toBe('claude-code');
    expect(profile.maxConcurrentTasks).toBe(1);
    expect(profile.archivedAt).toBeNull();
    expect(profile.configHash).toBeDefined();
    expect(profile.configHash).toHaveLength(64); // SHA-256 hex
    expect(profile.createdAt).toBeGreaterThan(0);
  });

  it('creates a profile with all fields', async () => {
    const profile = await manager.create('ws-1', 'key-1', {
      agentId: 'agent-abc',
      name: 'full-agent',
      description: 'A test agent',
      avatarUrl: 'https://example.com/avatar.png',
      runtimeMode: 'daemon',
      model: 'claude-sonnet-4-20250514',
      thinkingLevel: 'high',
      maxConcurrentTasks: 5,
      instructions: 'Be helpful',
      customEnv: [{ key: 'FOO', value: 'bar' }],
      customArgs: ['--verbose'],
      mcpConfig: { server1: { url: 'http://localhost:3000' } },
    });

    expect(profile.agentId).toBe('agent-abc');
    expect(profile.workspaceId).toBe('ws-1');
    expect(profile.description).toBe('A test agent');
    expect(profile.avatarUrl).toBe('https://example.com/avatar.png');
    expect(profile.runtimeMode).toBe('daemon');
    expect(profile.model).toBe('claude-sonnet-4-20250514');
    expect(profile.thinkingLevel).toBe('high');
    expect(profile.maxConcurrentTasks).toBe(5);
    expect(profile.instructions).toBe('Be helpful');
    expect(profile.customEnv).toEqual([{ key: 'FOO', value: 'bar' }]);
    expect(profile.customArgs).toEqual(['--verbose']);
    expect(profile.mcpConfig).toEqual({ server1: { url: 'http://localhost:3000' } });
    expect(profile.configHash).toBeDefined();
  });

  it('uses provided agentId or generates one', async () => {
    const withExplicit = await manager.create(null, 'key-1', { agentId: 'my-agent', name: 'a' });
    const without = await manager.create(null, 'key-1', { name: 'b' });

    expect(withExplicit.agentId).toBe('my-agent');
    expect(without.agentId).toBeDefined();
    expect(without.agentId).not.toBe(without.id); // separate UUID
  });

  // ── Read ──────────────────────────────────────────────────────

  it('gets a profile by id', async () => {
    const created = await manager.create(null, 'key-1', { name: 'getter-test' });
    const fetched = manager.get(created.id);

    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe('getter-test');
  });

  it('returns undefined for non-existent profile', () => {
    expect(manager.get('nope')).toBeUndefined();
  });

  it('lists all active profiles', async () => {
    await manager.create(null, 'key-1', { name: 'a' });
    await manager.create(null, 'key-1', { name: 'b' });

    const list = manager.list();
    expect(list).toHaveLength(2);
    // Sorted by updatedAt desc
    expect(list[0].name).toBe('b');
    expect(list[1].name).toBe('a');
  });

  it('excludes archived profiles by default', async () => {
    await manager.create(null, 'key-1', { name: 'active' });
    const toArchive = await manager.create(null, 'key-1', { name: 'archived' });
    await manager.archive(toArchive.id, 'key-1');

    const list = manager.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('active');
  });

  it('includes archived profiles when requested', async () => {
    await manager.create(null, 'key-1', { name: 'active' });
    const toArchive = await manager.create(null, 'key-1', { name: 'archived' });
    await manager.archive(toArchive.id, 'key-1');

    const list = manager.list({ includeArchived: true });
    expect(list).toHaveLength(2);
  });

  // ── Update ────────────────────────────────────────────────────

  it('updates a profile partially', async () => {
    const created = await manager.create(null, 'key-1', { name: 'original' });

    const updated = await manager.update(created.id, {
      name: 'renamed',
      description: 'updated desc',
    });

    expect(updated.name).toBe('renamed');
    expect(updated.description).toBe('updated desc');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    // configHash changes on update
    expect(updated.configHash).not.toBe(created.configHash);
  });

  it('throws on update of non-existent profile', async () => {
    await expect(manager.update('nope', { name: 'x' })).rejects.toThrow(AgentProfileNotFoundError);
  });

  it('throws on update of archived profile', async () => {
    const created = await manager.create(null, 'key-1', { name: 'archived' });
    await manager.archive(created.id, 'key-1');

    await expect(manager.update(created.id, { name: 'nope' })).rejects.toThrow(AgentProfileArchivedError);
  });

  // ── Archive / Restore ─────────────────────────────────────────

  it('archives a profile (soft delete)', async () => {
    const created = await manager.create(null, 'key-1', { name: 'to-archive' });

    const archived = await manager.archive(created.id, 'key-1');

    expect(archived.archivedAt).not.toBeNull();
    expect(archived.archivedBy).toBe('key-1');
  });

  it('restores an archived profile', async () => {
    const created = await manager.create(null, 'key-1', { name: 'to-restore' });
    await manager.archive(created.id, 'key-1');

    const restored = await manager.restore(created.id);

    expect(restored.archivedAt).toBeNull();
    expect(restored.archivedBy).toBeNull();

    // Now visible in listings again
    const list = manager.list();
    expect(list).toHaveLength(1);
  });

  it('archive is idempotent', async () => {
    const created = await manager.create(null, 'key-1', { name: 'idem' });
    const first = await manager.archive(created.id, 'key-1');
    const second = await manager.archive(created.id, 'key-1');

    expect(first.archivedAt).toEqual(second.archivedAt);
  });

  it('restore is idempotent', async () => {
    const created = await manager.create(null, 'key-1', { name: 'idem' });
    const restored = await manager.restore(created.id);

    expect(restored.archivedAt).toBeNull();
  });

  // ── Security: Name Validation (Themis #2) ─────────────────────

  describe('name validation', () => {
    it('rejects path traversal in name', async () => {
      await expect(
        manager.create(null, 'key-1', { name: '../../etc/passwd' }),
      ).rejects.toThrow(AgentProfileNameError);
    });

    it('rejects XSS in name', async () => {
      await expect(
        manager.create(null, 'key-1', { name: '<script>alert(1)</script>' }),
      ).rejects.toThrow(AgentProfileNameError);
    });

    it('rejects empty name', async () => {
      await expect(
        manager.create(null, 'key-1', { name: '' }),
      ).rejects.toThrow(AgentProfileNameError);
    });

    it('rejects name over 64 chars', async () => {
      await expect(
        manager.create(null, 'key-1', { name: 'a'.repeat(65) }),
      ).rejects.toThrow(AgentProfileNameError);
    });

    it('rejects unicode tricks in name', async () => {
      await expect(
        manager.create(null, 'key-1', { name: 'test\u0000agent' }),
      ).rejects.toThrow(AgentProfileNameError);
    });

    it('accepts valid names with hyphens and underscores', async () => {
      const profile = await manager.create(null, 'key-1', { name: 'my-agent_v2' });
      expect(profile.name).toBe('my-agent_v2');
    });

    it('rejects invalid name on update', async () => {
      const created = await manager.create(null, 'key-1', { name: 'valid' });
      await expect(
        manager.update(created.id, { name: '<script>' }),
      ).rejects.toThrow(AgentProfileNameError);
    });
  });

  // ── Security: Env Denylist (Themis #3) ────────────────────────

  describe('env denylist', () => {
    it('rejects ANTHROPIC_API_KEY in customEnv at create time', async () => {
      await expect(
        manager.create(null, 'key-1', {
          name: 'evil',
          customEnv: [{ key: 'ANTHROPIC_API_KEY', value: 'stolen-key' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('rejects PATH in customEnv', async () => {
      await expect(
        manager.create(null, 'key-1', {
          name: 'evil',
          customEnv: [{ key: 'PATH', value: '/malicious' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('rejects LD_PRELOAD in customEnv', async () => {
      await expect(
        manager.create(null, 'key-1', {
          name: 'evil',
          customEnv: [{ key: 'LD_PRELOAD', value: '/evil.so' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('rejects dangerous prefixes (npm_config_)', async () => {
      await expect(
        manager.create(null, 'key-1', {
          name: 'evil',
          customEnv: [{ key: 'npm_config_cache', value: '/tmp/evil' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('rejects CR/LF in env values', async () => {
      await expect(
        manager.create(null, 'key-1', {
          name: 'evil',
          customEnv: [{ key: 'FOO', value: 'bar\r\nMALICIOUS=true' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('rejects control chars in env values', async () => {
      await expect(
        manager.create(null, 'key-1', {
          name: 'evil',
          customEnv: [{ key: 'FOO', value: 'bar\x00injection' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('rejects denylisted env on update', async () => {
      const created = await manager.create(null, 'key-1', { name: 'valid' });
      await expect(
        manager.update(created.id, {
          customEnv: [{ key: 'HOME', value: '/evil' }],
        }),
      ).rejects.toThrow(AgentProfileEnvError);
    });

    it('allows safe env vars', async () => {
      const profile = await manager.create(null, 'key-1', {
        name: 'safe',
        customEnv: [{ key: 'MY_APP_CONFIG', value: 'production' }],
      });
      expect(profile.customEnv).toEqual([{ key: 'MY_APP_CONFIG', value: 'production' }]);
    });
  });

  // ── Config Hash ───────────────────────────────────────────────

  describe('configHash', () => {
    it('computes a stable hash on create', async () => {
      const profile = await manager.create(null, 'key-1', { name: 'hashed' });
      expect(profile.configHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('changes hash on update', async () => {
      const created = await manager.create(null, 'key-1', { name: 'hashed' });
      const originalHash = created.configHash;

      const updated = await manager.update(created.id, { name: 'renamed' });
      expect(updated.configHash).not.toBe(originalHash);
    });

    it('survives persistence round-trip', async () => {
      const created = await manager.create(null, 'key-1', { name: 'persistent-hash' });
      const originalHash = created.configHash;

      const manager2 = new AgentProfileManager(dataDir);
      await manager2.load();

      const fetched = manager2.get(created.id);
      expect(fetched!.configHash).toBe(originalHash);
    });
  });

  // ── Persistence ───────────────────────────────────────────────

  it('persists data across load cycles', async () => {
    const created = await manager.create('ws-1', 'key-1', { name: 'persistent' });

    const store2 = new JsonAgentStore(dataDir);
    const manager2 = new AgentProfileManager(store2);
    await manager2.load();

    const fetched = manager2.get(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('persistent');
    expect(fetched!.agentId).toBe(created.agentId);
    expect(fetched!.configHash).toBe(created.configHash);
  });

  it('handles missing data file gracefully', async () => {
    const emptyStore = new JsonAgentStore(dataDir);
    const empty = new AgentProfileManager(emptyStore);
    await empty.load();
    expect(empty.list()).toHaveLength(0);
  });
});
