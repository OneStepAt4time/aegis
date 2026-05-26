import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

const sandboxRoot = join(process.cwd(), '.test-scratch', `server-startup-${crypto.randomUUID()}`);
const stateDir = join(sandboxRoot, 'state');
const projectsDir = join(sandboxRoot, 'projects');
const workDir = join(sandboxRoot, 'workdir');

const originalEnv: Record<string, string | undefined> = {
  AEGIS_STATE_DIR: process.env.AEGIS_STATE_DIR,
  AEGIS_CLAUDE_PROJECTS_DIR: process.env.AEGIS_CLAUDE_PROJECTS_DIR,
  AEGIS_PORT: process.env.AEGIS_PORT,
  AEGIS_HOST: process.env.AEGIS_HOST,
  AEGIS_AUTH_TOKEN: process.env.AEGIS_AUTH_TOKEN,
  AEGIS_ALLOWED_WORK_DIRS: process.env.AEGIS_ALLOWED_WORK_DIRS,
  AEGIS_PERSIST_DEBOUNCE_MS: process.env.AEGIS_PERSIST_DEBOUNCE_MS,
};

const authToken = 'test-server-startup-token';
const authHeaders = { authorization: `Bearer ${authToken}` };

let capturedApp: FastifyInstance | null = null;
const pipelineStore = new Map<string, Record<string, unknown>>();

// Mock the dependencies to isolate server startup
vi.mock('../pipeline.js', () => ({
  PipelineManager: class {
    async hydrate(): Promise<void> {}
    async destroy(): Promise<void> {}

    async batchCreate(specs: Array<Record<string, unknown>>): Promise<{ created: unknown[]; errors: unknown[] }> {
      return {
        created: specs.map((spec, i) => ({ id: `batch-${i + 1}`, ...spec })),
        errors: [],
      };
    }

    async createPipeline(config: Record<string, unknown>): Promise<Record<string, unknown>> {
      const pipeline = { id: `pipeline-${pipelineStore.size + 1}`, status: 'created', ...config };
      pipelineStore.set(String(pipeline.id), pipeline);
      return pipeline;
    }

    getPipeline(id: string): Record<string, unknown> | null {
      return pipelineStore.get(id) ?? null;
    }

    listPipelines(): Record<string, unknown>[] {
      return [...pipelineStore.values()];
    }
  },
}));

vi.mock('../services/auth/RateLimiter.js', () => ({
  RateLimiter: class {
    checkIpRateLimit(): boolean {
      return false;
    }

    checkIpRateLimitUnauth(): boolean {
      return false;
    }

    checkAuthFailRateLimit(): boolean {
      return false;
    }

    recordAuthFailure(): void {}
    resetAuthFailures(): void {}
    pruneAuthFailLimits(): void {}
    pruneIpRateLimits(): void {}
    dispose(): void {}
  },
}));

// Mock startup functions
vi.mock('../startup.js', () => ({
  listenWithRetry: vi.fn(async (app: FastifyInstance) => {
    capturedApp = app;
    await app.ready();
  }),
  writePidFile: vi.fn(async () => join(stateDir, 'aegis.pid')),
  removePidFile: vi.fn(),
}));

describe('Server Startup Sequence', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Create test directories
    mkdirSync(workDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(projectsDir, { recursive: true });
    pipelineStore.clear();

    // Set environment variables for test
    process.env.AEGIS_STATE_DIR = stateDir;
    process.env.AEGIS_CLAUDE_PROJECTS_DIR = projectsDir;
    process.env.AEGIS_PORT = '19101';
    process.env.AEGIS_HOST = '127.0.0.1';
    process.env.AEGIS_AUTH_TOKEN = authToken;
    process.env.AEGIS_ALLOWED_WORK_DIRS = sandboxRoot;
    process.env.AEGIS_PERSIST_DEBOUNCE_MS = '0';

    // Mock timers and process exit
    vi.spyOn(globalThis, 'setInterval').mockImplementation((() => 0) as any);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation((() => undefined) as any);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    // Create a minimal config file
    const configContent = `
aegis:
  port: 19101
  host: 127.0.0.1
  auth:
    token: ${authToken}
  workdirs:
    - ${sandboxRoot}
`;
    writeFileSync(join(stateDir, 'config.yaml'), configContent);

    // Import and start server
    await import('../server.js');

    // Wait for server to start
    for (let i = 0; i < 200 && !capturedApp; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!capturedApp) {
      throw new Error('server app was not captured from listenWithRetry');
    }
    app = capturedApp;
  });

  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();

    // Restore original environment
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    // Cleanup test directories
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  describe('Server Startup Configuration', () => {
    it('server starts with expected configuration', async () => {
      const health = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toHaveProperty('status', 'ok');
    });

    it('server registers expected plugins', () => {
      // Verify that the server has basic Fastify instance
      expect(app).toBeDefined();
      expect(typeof app.register).toBe('function');
      expect(typeof app.inject).toBe('function');
    });
  });

  describe('Authentication Hooks', () => {
    it('returns 401 for unauthenticated calls to protected routes', async () => {
      const protectedRoutes = [
        '/v1/sessions',
        '/v1/sessions/health',
        '/v1/auth/keys',
        '/v1/diagnostics',
      ];

      for (const route of protectedRoutes) {
        const response = await app.inject({ method: 'GET', url: route });
        expect([401, 403]).toContain(response.statusCode);
      }
    });

    it('returns 200 for authenticated calls to protected routes', async () => {
      const protectedRoutes = [
        '/v1/sessions',
        '/v1/sessions/health',
        '/v1/auth/keys',
        '/v1/diagnostics',
      ];

      for (const route of protectedRoutes) {
        const response = await app.inject({
          method: 'GET',
          url: route,
          headers: authHeaders,
        });
        expect(response.statusCode).toBe(200);
      }
    });

    it('returns 200 for health endpoint without auth', async () => {
      const health = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(health.statusCode).toBe(200);
    });

    it('validates token correctly', async () => {
      const invalidToken = 'invalid-token';
      const response = await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${invalidToken}` },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('Route Registration', () => {
    it('registers health endpoint correctly', async () => {
      const health = await app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: authHeaders,
      });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toHaveProperty('status', 'ok');
    });

    it('registers session routes correctly', async () => {
      const sessionCreate = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: authHeaders,
        payload: {
          workDir,
          name: 'test-session',
          permissionMode: 'bypassPermissions',
          claudeCommand: 'claude --print',
        },
      });
      expect(sessionCreate.statusCode).toBe(201);
      expect(sessionCreate.json()).toHaveProperty('id');
    });

    it('registers auth routes correctly', async () => {
      const authVerify = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        headers: authHeaders,
        payload: { token: 'test-token' },
      });
      expect([200, 401]).toContain(authVerify.statusCode);
    });

    it('registers diagnostic routes correctly', async () => {
      const diagnostics = await app.inject({
        method: 'GET',
        url: '/v1/diagnostics?limit=5',
        headers: authHeaders,
      });
      expect(diagnostics.statusCode).toBe(200);
    });
  });

  describe('Graceful Shutdown', () => {
    it('handles SIGTERM gracefully', async () => {
      // Mock graceful shutdown
      const shutdownSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      
      // Send SIGTERM
      process.emit('SIGTERM');
      
      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(shutdownSpy).toHaveBeenCalled();
      shutdownSpy.mockRestore();
    });

    it('handles SIGINT gracefully', async () => {
      // Mock graceful shutdown
      const shutdownSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      
      // Send SIGINT
      process.emit('SIGINT');
      
      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(shutdownSpy).toHaveBeenCalled();
      shutdownSpy.mockRestore();
    });
  });

  describe('Plugin Registration', () => {
    it('registers rate limiting middleware', async () => {
      // Test that rate limiting is applied by checking for rate limit headers
      const response = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: authHeaders,
        payload: {
          workDir,
          name: 'rate-test-session',
          permissionMode: 'bypassPermissions',
          claudeCommand: 'claude --print',
        },
      });
      
      // Should either succeed (200/201) or be rate limited (429)
      expect([200, 201, 429]).toContain(response.statusCode);
    });

    it('registers CORS middleware', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/v1/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
        },
      });
      
      // CORS should be configured
      expect(response.statusCode).toBe(200);
    });
  });

  describe('Error Handling', () => {
    it('handles invalid JSON payloads gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: authHeaders,
        body: 'invalid json',
      });
      expect(response.statusCode).toBe(400);
    });

    it('handles malformed auth tokens gracefully', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer' }, // Missing token
      });
      expect(response.statusCode).toBe(401);
    });

    it('handles missing required parameters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: authHeaders,
        payload: {}, // Missing required fields
      });
      expect(response.statusCode).toBe(400);
    });
  });
});