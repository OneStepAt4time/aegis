/**
 * Tests for Issue #3999: Agent Identity Model.
 *
 * Covers: CRUD, permission scoping, session validation.
 * Storage tests use in-memory AgentManager (no file I/O).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentManager, AgentNotFoundError, AgentDeactivatedError, AgentPermissionDeniedError } from '../services/agents/AgentManager.js';
import type { ApiKey } from '../services/auth/types.js';
import { API_KEY_PERMISSION_VALUES } from '../services/auth/permissions.js';

function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-admin-1',
    name: 'test-admin',
    hash: 'sha256:fake',
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    rateLimit: 100,
    expiresAt: null,
    role: 'admin',
    permissions: [...API_KEY_PERMISSION_VALUES],
    ...overrides,
  };
}

const ADMIN_KEY = makeApiKey();
const OPERATOR_KEY = makeApiKey({
  id: 'key-operator-1',
  name: 'test-operator',
  role: 'operator',
  permissions: ['create', 'send'],
});
const VIEWER_KEY = makeApiKey({
  id: 'key-viewer-1',
  name: 'test-viewer',
  role: 'viewer',
  permissions: [],
});

describe('Issue #3999: AgentManager', () => {
  let manager: AgentManager;

  beforeEach(async () => {
    // Use temp dir — each test gets clean state
    const tmpDir = `/tmp/aegis-test-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    manager = new AgentManager(tmpDir);
    await manager.load();
  });

  // ── Create ────────────────────────────────────────────────────

  describe('create', () => {
    it('creates an agent with defaults', async () => {
      const agent = await manager.create(ADMIN_KEY, {
        name: 'claude-code-hep',
        runnerType: 'claude-code',
      });

      expect(agent.id).toBeTruthy();
      expect(agent.name).toBe('claude-code-hep');
      expect(agent.runnerType).toBe('claude-code');
      expect(agent.status).toBe('active');
      expect(agent.ownerKeyId).toBe(ADMIN_KEY.id);
      expect(agent.createdAt).toBeGreaterThan(0);
    });

    it('scopes permissions to owner key', async () => {
      const agent = await manager.create(OPERATOR_KEY, {
        name: 'scoped-agent',
        runnerType: 'codex',
        permissions: ['create', 'send', 'approve'], // approve not in operator's perms
      });

      // Should only have create + send (subset of operator's permissions)
      expect(agent.permissions).toEqual(['create', 'send']);
    });

    it('inherits owner role', async () => {
      const agent = await manager.create(OPERATOR_KEY, {
        name: 'role-agent',
        runnerType: 'gemini-cli',
      });

      expect(agent.role).toBe('operator');
    });

    it('applies custom constraints', async () => {
      const agent = await manager.create(ADMIN_KEY, {
        name: 'constrained-agent',
        runnerType: 'claude-code',
        constraints: { maxConcurrentSessions: 3, allowedModels: ['opus'] },
      });

      expect(agent.constraints.maxConcurrentSessions).toBe(3);
      expect(agent.constraints.allowedModels).toEqual(['opus']);
      // Defaults for unspecified constraints
      expect(agent.constraints.maxTokensPerSession).toBeNull();
      expect(agent.constraints.deniedTools).toEqual([]);
    });
  });

  // ── Read ──────────────────────────────────────────────────────

  describe('get / list', () => {
    it('gets agent by id', async () => {
      const created = await manager.create(ADMIN_KEY, {
        name: 'test-agent',
        runnerType: 'claude-code',
      });

      const found = manager.get(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('test-agent');
    });

    it('returns undefined for nonexistent agent', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('lists all agents', async () => {
      await manager.create(ADMIN_KEY, { name: 'a1', runnerType: 'cc' });
      await manager.create(ADMIN_KEY, { name: 'a2', runnerType: 'codex' });

      const all = manager.list();
      expect(all).toHaveLength(2);
    });

    it('filters by owner key', async () => {
      await manager.create(ADMIN_KEY, { name: 'admin-agent', runnerType: 'cc' });
      await manager.create(OPERATOR_KEY, { name: 'op-agent', runnerType: 'codex' });

      const adminAgents = manager.list({ ownerKeyId: ADMIN_KEY.id });
      expect(adminAgents).toHaveLength(1);
      expect(adminAgents[0].name).toBe('admin-agent');
    });

    it('filters by status', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'to-deactivate', runnerType: 'cc' });
      await manager.deactivate(agent.id, ADMIN_KEY);

      const active = manager.list({ status: 'active' });
      expect(active).toHaveLength(0);

      const deactivated = manager.list({ status: 'deactivated' });
      expect(deactivated).toHaveLength(1);
    });
  });

  // ── Update ────────────────────────────────────────────────────

  describe('update', () => {
    it('updates name and description', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'old', runnerType: 'cc' });
      const updated = await manager.update(agent.id, { name: 'new', description: 'updated' }, ADMIN_KEY);

      expect(updated.name).toBe('new');
      expect(updated.description).toBe('updated');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(agent.createdAt);
    });

    it('rejects update from non-owner non-admin', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'owned', runnerType: 'cc' });

      await expect(
        manager.update(agent.id, { name: 'hacked' }, VIEWER_KEY),
      ).rejects.toThrow(AgentPermissionDeniedError);
    });

    it('scopes updated permissions to requester', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'perms', runnerType: 'cc' });
      const updated = await manager.update(agent.id, {
        permissions: ['create'], // admin has all perms, so subset is fine
      }, ADMIN_KEY);

      expect(updated.permissions).toEqual(['create']);
    });
  });

  // ── Deactivate ────────────────────────────────────────────────

  describe('deactivate', () => {
    it('deactivates an active agent', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'to-kill', runnerType: 'cc' });
      const deactivated = await manager.deactivate(agent.id, ADMIN_KEY);

      expect(deactivated.status).toBe('deactivated');
    });

    it('idempotent on already-deactivated agent', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'already-dead', runnerType: 'cc' });
      await manager.deactivate(agent.id, ADMIN_KEY);
      const result = await manager.deactivate(agent.id, ADMIN_KEY);

      expect(result.status).toBe('deactivated');
    });

    it('rejects deactivate from non-owner non-admin', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'protected', runnerType: 'cc' });

      await expect(
        manager.deactivate(agent.id, VIEWER_KEY),
      ).rejects.toThrow(AgentPermissionDeniedError);
    });
  });

  // ── Session validation ────────────────────────────────────────

  describe('validateForSession', () => {
    it('returns agent for valid active agent', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'valid', runnerType: 'cc' });
      const result = manager.validateForSession(agent.id, ADMIN_KEY);

      expect(result.id).toBe(agent.id);
    });

    it('throws for nonexistent agent', () => {
      expect(() => manager.validateForSession('nonexistent', ADMIN_KEY)).toThrow(AgentNotFoundError);
    });

    it('throws for deactivated agent', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'dead', runnerType: 'cc' });
      await manager.deactivate(agent.id, ADMIN_KEY);

      expect(() => manager.validateForSession(agent.id, ADMIN_KEY)).toThrow(AgentDeactivatedError);
    });

    it('throws for non-owner non-admin', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'owned', runnerType: 'cc' });

      expect(() => manager.validateForSession(agent.id, VIEWER_KEY)).toThrow(AgentPermissionDeniedError);
    });

    it('allows admin to use any agent', async () => {
      const agent = await manager.create(OPERATOR_KEY, { name: 'op-agent', runnerType: 'codex' });
      const result = manager.validateForSession(agent.id, ADMIN_KEY);

      expect(result.id).toBe(agent.id);
    });
  });

  // ── Persistence ───────────────────────────────────────────────

  describe('persistence', () => {
    it('persists agents across load cycles', async () => {
      const agent = await manager.create(ADMIN_KEY, { name: 'persist-test', runnerType: 'cc' });

      // Create new manager instance pointing to same dir
      const tmpDir = (manager as unknown as { filePath: string }).filePath.replace('/agents.json', '');
      const manager2 = new AgentManager(tmpDir);
      await manager2.load();

      const found = manager2.get(agent.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('persist-test');
    });
  });
});
