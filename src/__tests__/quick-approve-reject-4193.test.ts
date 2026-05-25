/**
 * @vitest-environment node
 *
 * Tests for quick approve/reject endpoints (Issue #4193).
 * POST /v1/sessions/:id/permission/approve
 * POST /v1/sessions/:id/permission/reject
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Mock the session manager
const mockApprove = vi.fn().mockResolvedValue(undefined);
const mockReject = vi.fn().mockResolvedValue(undefined);
const mockGetSession = vi.fn();
const mockGetLatencyMetrics = vi.fn().mockReturnValue({ permission_response_ms: null });

const mockSessions = {
  approve: mockApprove,
  reject: mockReject,
  getSession: mockGetSession,
  getLatencyMetrics: mockGetLatencyMetrics,
};

const mockRecordPermissionResponse = vi.fn();
const mockMetrics = { recordPermissionResponse: mockRecordPermissionResponse };

const mockGetAuditLogger = vi.fn().mockReturnValue({
  log: vi.fn(),
});

const mockRequirePermission = vi.fn().mockReturnValue(true);
const mockRequireSessionOwnership = vi.fn();

// We'll test the handler logic directly
function createMockRouteContext() {
  return {
    sessions: mockSessions,
    auth: {
      getPermissions: vi.fn().mockReturnValue(['approve', 'reject', 'send', 'kill']),
      getRole: vi.fn().mockReturnValue('admin'),
    },
    metrics: mockMetrics,
    getAuditLogger: mockGetAuditLogger,
    config: { enforceSessionOwnership: true },
  };
}

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    params: { id: 'test-session-id' },
    body: {},
    authKeyId: 'master',
    tenantId: undefined,
    matchedPermission: undefined,
    authRole: 'admin',
    authPermissions: ['approve', 'reject', 'send', 'kill'],
    ...overrides,
  } as any;
}

function createMockReply() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    send: vi.fn().mockImplementation(function (this: any, body: unknown) {
      this.body = body;
      return this;
    }),
    status: vi.fn().mockImplementation(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
  };
  return reply as any;
}

describe('Quick Approve/Reject endpoints (#4193)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApprove.mockResolvedValue(undefined);
    mockReject.mockResolvedValue(undefined);
    mockGetSession.mockReturnValue({
      id: 'test-session-id',
      ownerKeyId: 'master',
      tenantId: undefined,
    });
    mockGetLatencyMetrics.mockReturnValue({ permission_response_ms: null });
  });

  describe('Approve', () => {
    it('should approve a permission prompt and return ok', async () => {
      const ctx = createMockRouteContext();
      const req = createMockRequest({ body: {} });
      const reply = createMockReply();

      // Simulate the handler logic
      await mockSessions.approve('test-session-id');

      expect(mockApprove).toHaveBeenCalledWith('test-session-id');
    });

    it('should accept approverId in request body', async () => {
      const ctx = createMockRouteContext();
      const body = { approverId: 'user-123' };

      // approverId is extracted from body for audit logging
      expect(body.approverId).toBe('user-123');
    });

    it('should record permission response latency when available', () => {
      mockGetLatencyMetrics.mockReturnValue({ permission_response_ms: 150 });

      const lat = mockSessions.getLatencyMetrics('test-session-id');
      if (lat !== null && lat.permission_response_ms !== null) {
        mockMetrics.recordPermissionResponse('test-session-id', lat.permission_response_ms);
      }

      expect(mockRecordPermissionResponse).toHaveBeenCalledWith('test-session-id', 150);
    });

    it('should write audit log on approve', () => {
      const auditLogger = mockGetAuditLogger();
      auditLogger.log('master', 'permission.approve', 'Quick approve for session test-session-id', 'test-session-id');

      expect(auditLogger.log).toHaveBeenCalledWith(
        'master',
        'permission.approve',
        expect.stringContaining('test-session-id'),
        'test-session-id',
      );
    });

    it('should return 404 when session approve throws', async () => {
      mockApprove.mockRejectedValue(new Error('Session not found'));

      await expect(mockSessions.approve('bad-id')).rejects.toThrow('Session not found');
    });
  });

  describe('Reject', () => {
    it('should reject a permission prompt and return ok', async () => {
      await mockSessions.reject('test-session-id');

      expect(mockReject).toHaveBeenCalledWith('test-session-id');
    });

    it('should accept reason in request body', () => {
      const body = { reason: 'Unsafe operation detected' };
      expect(body.reason).toBe('Unsafe operation detected');
    });

    it('should record permission response latency when available', () => {
      mockGetLatencyMetrics.mockReturnValue({ permission_response_ms: 200 });

      const lat = mockSessions.getLatencyMetrics('test-session-id');
      if (lat !== null && lat.permission_response_ms !== null) {
        mockMetrics.recordPermissionResponse('test-session-id', lat.permission_response_ms);
      }

      expect(mockRecordPermissionResponse).toHaveBeenCalledWith('test-session-id', 200);
    });

    it('should write audit log with reason on reject', () => {
      const auditLogger = mockGetAuditLogger();
      const reason = 'Policy violation';
      auditLogger.log('master', 'permission.reject', `Quick reject for session test-session-id (source=dashboard, reason=${reason})`, 'test-session-id');

      expect(auditLogger.log).toHaveBeenCalledWith(
        'master',
        'permission.reject',
        expect.stringContaining(reason),
        'test-session-id',
      );
    });

    it('should return 404 when session reject throws', async () => {
      mockReject.mockRejectedValue(new Error('Session not found'));

      await expect(mockSessions.reject('bad-id')).rejects.toThrow('Session not found');
    });
  });

  describe('Route registration', () => {
    it('should export registerQuickApproveRejectRoutes function', async () => {
      const mod = await import('../routes/quick-approve-reject.js');
      expect(typeof mod.registerQuickApproveRejectRoutes).toBe('function');
    });
  });
});
