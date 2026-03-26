/**
 * server.ts — HTTP API server for Aegis.
 *
 * Exposes RESTful endpoints for creating, managing, and interacting
 * with Claude Code sessions running in tmux.
 *
 * Notification channels (Telegram, webhooks, etc.) are pluggable —
 * the server doesn't know which channels are active.
 */

import Fastify from 'fastify';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TmuxManager } from './tmux.js';
import { SessionManager } from './session.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from './monitor.js';
import { JsonlWatcher } from './jsonl-watcher.js';
import {
  ChannelManager,
  TelegramChannel,
  WebhookChannel,
  type InboundCommand,
  type SessionEvent,
  type SessionEventPayload,
} from './channels/index.js';
import { loadConfig, type Config } from './config.js';
import { captureScreenshot, isPlaywrightAvailable } from './screenshot.js';
import { SessionEventBus, type SessionSSEEvent, type GlobalSSEEvent } from './events.js';
import { PipelineManager, type BatchSessionSpec, type PipelineConfig } from './pipeline.js';
import { AuthManager } from './auth.js';
import { MetricsCollector } from './metrics.js';
import { registerHookRoutes } from './hooks.js';
import { registerWsTerminalRoute } from './ws-terminal.js';
import { SwarmMonitor } from './swarm-monitor.js';
import { execSync } from 'node:child_process';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Configuration ────────────────────────────────────────────────────

// Config loaded at startup; env vars override file values
let config: Config;

// These will be initialized after config is loaded
let tmux: TmuxManager;
let sessions: SessionManager;
let monitor: SessionMonitor;
let jsonlWatcher: JsonlWatcher;
const channels = new ChannelManager();
const eventBus = new SessionEventBus();
let pipelines: PipelineManager;
let auth: AuthManager;
let metrics: MetricsCollector;
let swarmMonitor: SwarmMonitor;

// ── Inbound command handler ─────────────────────────────────────────

async function handleInbound(cmd: InboundCommand): Promise<void> {
  try {
    switch (cmd.action) {
      case 'approve':
        await sessions.approve(cmd.sessionId);
        break;
      case 'reject':
        await sessions.reject(cmd.sessionId);
        break;
      case 'escape':
        await sessions.escape(cmd.sessionId);
        break;
      case 'kill':
        await channels.sessionEnded(makePayload('session.ended', cmd.sessionId, 'killed'));
        await sessions.killSession(cmd.sessionId);
        monitor.removeSession(cmd.sessionId);
        break;
      case 'message':
      case 'command':
        if (cmd.text) await sessions.sendMessage(cmd.sessionId, cmd.text);
        break;
    }
  } catch (e) {
    console.error(`Inbound command error [${cmd.action}]:`, e);
  }
}

// ── HTTP Server ─────────────────────────────────────────────────────

const app = Fastify({ logger: true });

// Auth middleware setup (Issue #39: multi-key auth with rate limiting)
function setupAuth(authManager: AuthManager): void {
  app.addHook('onRequest', async (req, reply) => {
    // Skip auth for health endpoint, auth key management, and dashboard
    // #126: Dashboard is served as public static files; API endpoints are protected
    if (req.url === '/health' || req.url === '/v1/health' || req.url === '/dashboard' || req.url?.startsWith('/dashboard/') || req.url?.startsWith('/dashboard?')) return;
    if (req.url?.startsWith('/v1/hooks')) return;
    if (req.url === '/dashboard' || req.url?.startsWith('/dashboard/') || req.url?.startsWith('/dashboard?')) return;

    // If no auth configured (no master token, no keys), allow all
    if (!authManager.authEnabled) return;

    // #124/#125: Accept token from Authorization header or ?token= query param
    // Query param fallback needed for EventSource (SSE) which cannot set headers
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7);
    } else {
      token = (req.query as Record<string, string>).token;
    }

    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    const result = authManager.validate(token);

    if (!result.valid) {
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }

    if (result.rateLimited) {
      return reply.status(429).send({ error: 'Rate limit exceeded — 100 req/min per key' });
    }
  });
}

// ── v1 API Routes ───────────────────────────────────────────────────

// Health
app.get('/v1/health', async () => {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  const activeCount = sessions.listSessions().length;
  const totalCount = metrics.getTotalSessionsCreated();
  return {
    status: 'ok',
    version: pkg.default.version,
    uptime: process.uptime(),
    sessions: { active: activeCount, total: totalCount },
    timestamp: new Date().toISOString(),
  };
});

// Backwards compat: unversioned health
app.get('/health', async () => {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  const activeCount = sessions.listSessions().length;
  const totalCount = metrics.getTotalSessionsCreated();
  return {
    status: 'ok',
    version: pkg.default.version,
    uptime: process.uptime(),
    sessions: { active: activeCount, total: totalCount },
    timestamp: new Date().toISOString(),
  };
});

// Issue #81: Swarm awareness — list all detected CC swarms and their teammates
app.get('/v1/swarm', async () => {
  const result = await swarmMonitor.scan();
  return result;
});

// API key management (Issue #39)
app.post<{ Body: { name?: string; rateLimit?: number } }>('/v1/auth/keys', async (req, reply) => {
  const { name, rateLimit } = req.body || {};
  if (!name) return reply.status(400).send({ error: 'name is required' });
  const result = await auth.createKey(name, rateLimit);
  return reply.status(201).send(result);
});

app.get('/v1/auth/keys', async () => auth.listKeys());

app.delete<{ Params: { id: string } }>('/v1/auth/keys/:id', async (req, reply) => {
  const revoked = await auth.revokeKey(req.params.id);
  if (!revoked) return reply.status(404).send({ error: 'Key not found' });
  return { ok: true };
});

// Global metrics (Issue #40)
app.get('/v1/metrics', async () => metrics.getGlobalMetrics(sessions.listSessions().length));

// Per-session metrics (Issue #40)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/metrics', async (req, reply) => {
  const m = metrics.getSessionMetrics(req.params.id);
  if (!m) return reply.status(404).send({ error: 'No metrics for this session' });
  return m;
});

// Issue #89 L14: Webhook dead letter queue
app.get('/v1/webhooks/dead-letter', async () => {
  for (const ch of channels.getChannels()) {
    if (ch.name === 'webhook' && 'getDeadLetterQueue' in ch) {
      return (ch as any).getDeadLetterQueue();
    }
  }
  return [];
});

// Issue #89 L15: Per-channel health reporting
app.get('/v1/channels/health', async () => {
  return channels.getChannels().map(ch => {
    const health = (ch as any).getHealth?.();
    if (health) return health;
    return { channel: ch.name, healthy: true, lastSuccess: null, lastError: null, pendingCount: 0 };
  });
});

// Issue #87: Per-session latency metrics
app.get<{ Params: { id: string } }>('/v1/sessions/:id/latency', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const realtimeLatency = sessions.getLatencyMetrics(req.params.id);
  const aggregatedLatency = metrics.getSessionLatency(req.params.id);

  return {
    sessionId: req.params.id,
    realtime: realtimeLatency,
    aggregated: aggregatedLatency,
  };
});

// Global SSE event stream — aggregates events from ALL active sessions
app.get('/v1/events', async (_req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const activeSessions = sessions.listSessions();
  reply.raw.write(`data: ${JSON.stringify({
    event: 'connected',
    timestamp: new Date().toISOString(),
    data: { activeSessions: activeSessions.length },
  })}\n\n`);

  const handler = (event: GlobalSSEEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch { /* connection closed */ }
  };

  const unsubscribe = eventBus.subscribeGlobal(handler);

  const heartbeat = setInterval(() => {
    try { reply.raw.write(`data: ${JSON.stringify({ event: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`); } catch { clearInterval(heartbeat); }
  }, 30_000);

  _req.raw.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  await reply;
});

// List sessions (with pagination and status filter)
app.get<{
  Querystring: { page?: string; limit?: string; status?: string };
}>('/v1/sessions', async (req) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const statusFilter = req.query.status;

  let all = sessions.listSessions();
  if (statusFilter) {
    all = all.filter(s => s.status === statusFilter);
  }

  // Sort by createdAt descending (newest first)
  all.sort((a, b) => b.createdAt - a.createdAt);

  const total = all.length;
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);

  return {
    sessions: items,
    total,
    page,
    limit,
  };
});
// Backwards compat: /sessions (no prefix) returns raw array
app.get('/sessions', async () => sessions.listSessions());

// Create session
app.post<{
  Body: {
    workDir: string;
    name?: string;
    prompt?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
    stallThresholdMs?: number;
    permissionMode?: string;
    autoApprove?: boolean;
  };
}>('/v1/sessions', async (req, reply) => {
  const { workDir, name, prompt, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove } = req.body;
  console.time("POST_CREATE_SESSION");
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  const session = await sessions.createSession({ workDir, name, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove });
  console.timeEnd("POST_CREATE_SESSION"); console.time("POST_CHANNEL_CREATED");

  // Issue #46: Create Telegram topic BEFORE sending prompt.
  // The monitor starts polling immediately after createSession().
  // If we wait for sendInitialPrompt (up to 15s), the monitor may find
  // new messages but can't forward them because no topic exists yet.
  // Those messages are lost forever (monitorOffset advances past them).
  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}`,
    meta: prompt ? { prompt: prompt.slice(0, 200), permissionMode: permissionMode ?? (autoApprove ? 'bypassPermissions' : undefined) } : undefined,
  });
  console.timeEnd("POST_CHANNEL_CREATED"); console.time("POST_SEND_INITIAL_PROMPT");

  // Now send the prompt (topic exists, monitor can forward messages)
  console.timeEnd("POST_SEND_INITIAL_PROMPT"); console.time("POST_REPLY");
  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  console.timeEnd("POST_REPLY");
  if (prompt) {
    promptDelivery = await sessions.sendInitialPrompt(session.id, prompt);
    metrics.promptSent(promptDelivery.delivered);
  }

  return reply.status(201).send({ ...session, promptDelivery });
});

// Backwards compat
app.post<{
  Body: {
    workDir: string;
    name?: string;
    prompt?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
    stallThresholdMs?: number;
    permissionMode?: string;
    autoApprove?: boolean;
  };
}>('/sessions', async (req, reply) => {
  const { workDir, name, prompt, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove } = req.body;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  const session = await sessions.createSession({ workDir, name, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove });

  // Issue #46: Topic first, then prompt (same fix as v1 route)
  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}`,
    meta: prompt ? { prompt: prompt.slice(0, 200), permissionMode: permissionMode ?? (autoApprove ? 'bypassPermissions' : undefined) } : undefined,
  });

  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  if (prompt) {
    promptDelivery = await sessions.sendInitialPrompt(session.id, prompt);
    metrics.promptSent(promptDelivery.delivered);
  }

  return reply.status(201).send({ ...session, promptDelivery });
});

// Get session (Issue #20: includes actionHints for interactive states)
app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  return addActionHints(session);
});
app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  return addActionHints(session);
});

// #128: Bulk health check — returns health for all sessions in one request
app.get('/v1/sessions/health', async () => {
  const allSessions = sessions.listSessions();
  const results: Record<string, {
    alive: boolean;
    windowExists: boolean;
    claudeRunning: boolean;
    paneCommand: string | null;
    status: string;
    hasTranscript: boolean;
    lastActivity: number;
    lastActivityAgo: number;
    sessionAge: number;
    details: string;
  }> = {};
  await Promise.all(allSessions.map(async (s) => {
    try {
      results[s.id] = await sessions.getHealth(s.id);
    } catch {
      results[s.id] = {
        alive: false, windowExists: false, claudeRunning: false,
        paneCommand: null, status: 'unknown', hasTranscript: false,
        lastActivity: 0, lastActivityAgo: 0, sessionAge: 0,
        details: 'Error fetching health',
      };
    }
  }));
  return results;
});

// Session health check (Issue #2)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/health', async (req, reply) => {
  try {
    return await sessions.getHealth(req.params.id);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.get<{ Params: { id: string } }>('/sessions/:id/health', async (req, reply) => {
  try {
    return await sessions.getHealth(req.params.id);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Send message (with delivery verification — Issue #1)
app.post<{ Params: { id: string }; Body: { text: string } }>(
  '/v1/sessions/:id/send',
  async (req, reply) => {
    const { text } = req.body;
    if (!text) return reply.status(400).send({ error: 'text is required' });
    try {
      const result = await sessions.sendMessage(req.params.id, text);
      await channels.message({
        event: 'message.user',
        timestamp: new Date().toISOString(),
        session: { id: req.params.id, name: '', workDir: '' },
        detail: text,
      });
      return { ok: true, delivered: result.delivered, attempts: result.attempts };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  },
);
app.post<{ Params: { id: string }; Body: { text: string } }>(
  '/sessions/:id/send',
  async (req, reply) => {
    const { text } = req.body;
    if (!text) return reply.status(400).send({ error: 'text is required' });
    try {
      const result = await sessions.sendMessage(req.params.id, text);
      await channels.message({
        event: 'message.user',
        timestamp: new Date().toISOString(),
        session: { id: req.params.id, name: '', workDir: '' },
        detail: text,
      });
      return { ok: true, delivered: result.delivered, attempts: result.attempts };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  },
);

// Read messages
app.get<{ Params: { id: string } }>('/v1/sessions/:id/read', async (req, reply) => {
  try {
    return await sessions.readMessages(req.params.id);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.get<{ Params: { id: string } }>('/sessions/:id/read', async (req, reply) => {
  try {
    return await sessions.readMessages(req.params.id);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Approve
app.post<{ Params: { id: string } }>('/v1/sessions/:id/approve', async (req, reply) => {
  try {
    await sessions.approve(req.params.id);
    // Issue #87: Record permission response latency
    const lat = sessions.getLatencyMetrics(req.params.id);
    if (lat !== null && lat.permission_response_ms !== null) {
      metrics.recordPermissionResponse(req.params.id, lat.permission_response_ms);
    }
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.post<{ Params: { id: string } }>('/sessions/:id/approve', async (req, reply) => {
  try {
    await sessions.approve(req.params.id);
    const lat = sessions.getLatencyMetrics(req.params.id);
    if (lat !== null && lat.permission_response_ms !== null) {
      metrics.recordPermissionResponse(req.params.id, lat.permission_response_ms);
    }
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Reject
app.post<{ Params: { id: string } }>('/v1/sessions/:id/reject', async (req, reply) => {
  try {
    await sessions.reject(req.params.id);
    const lat = sessions.getLatencyMetrics(req.params.id);
    if (lat !== null && lat.permission_response_ms !== null) {
      metrics.recordPermissionResponse(req.params.id, lat.permission_response_ms);
    }
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.post<{ Params: { id: string } }>('/sessions/:id/reject', async (req, reply) => {
  try {
    await sessions.reject(req.params.id);
    const lat = sessions.getLatencyMetrics(req.params.id);
    if (lat !== null && lat.permission_response_ms !== null) {
      metrics.recordPermissionResponse(req.params.id, lat.permission_response_ms);
    }
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Escape
app.post<{ Params: { id: string } }>('/v1/sessions/:id/escape', async (req, reply) => {
  try {
    await sessions.escape(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.post<{ Params: { id: string } }>('/sessions/:id/escape', async (req, reply) => {
  try {
    await sessions.escape(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Interrupt (Ctrl+C)
app.post<{ Params: { id: string } }>('/v1/sessions/:id/interrupt', async (req, reply) => {
  try {
    await sessions.interrupt(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.post<{ Params: { id: string } }>('/sessions/:id/interrupt', async (req, reply) => {
  try {
    await sessions.interrupt(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Kill session
app.delete<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
  try {
    eventBus.emitEnded(req.params.id, 'killed');
    await channels.sessionEnded(makePayload('session.ended', req.params.id, 'killed'));
    await sessions.killSession(req.params.id);
    monitor.removeSession(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
  try {
    await channels.sessionEnded(makePayload('session.ended', req.params.id, 'killed'));
    await sessions.killSession(req.params.id);
    monitor.removeSession(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Capture raw pane
app.get<{ Params: { id: string } }>('/v1/sessions/:id/pane', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  const pane = await tmux.capturePane(session.windowId);
  return { pane };
});
app.get<{ Params: { id: string } }>('/sessions/:id/pane', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  const pane = await tmux.capturePane(session.windowId);
  return { pane };
});

// Slash command
app.post<{ Params: { id: string }; Body: { command: string } }>(
  '/v1/sessions/:id/command',
  async (req, reply) => {
    const { command } = req.body;
    if (!command) return reply.status(400).send({ error: 'command is required' });
    try {
      const cmd = command.startsWith('/') ? command : `/${command}`;
      await sessions.sendMessage(req.params.id, cmd);
      return { ok: true };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  },
);
app.post<{ Params: { id: string }; Body: { command: string } }>(
  '/sessions/:id/command',
  async (req, reply) => {
    const { command } = req.body;
    if (!command) return reply.status(400).send({ error: 'command is required' });
    try {
      const cmd = command.startsWith('/') ? command : `/${command}`;
      await sessions.sendMessage(req.params.id, cmd);
      return { ok: true };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  },
);

// Bash mode
app.post<{ Params: { id: string }; Body: { command: string } }>(
  '/v1/sessions/:id/bash',
  async (req, reply) => {
    const { command } = req.body;
    if (!command) return reply.status(400).send({ error: 'command is required' });
    try {
      const cmd = command.startsWith('!') ? command : `!${command}`;
      await sessions.sendMessage(req.params.id, cmd);
      return { ok: true };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  },
);
app.post<{ Params: { id: string }; Body: { command: string } }>(
  '/sessions/:id/bash',
  async (req, reply) => {
    const { command } = req.body;
    if (!command) return reply.status(400).send({ error: 'command is required' });
    try {
      const cmd = command.startsWith('!') ? command : `!${command}`;
      await sessions.sendMessage(req.params.id, cmd);
      return { ok: true };
    } catch (e: any) {
      return reply.status(404).send({ error: e.message });
    }
  },
);

// Session summary (Issue #35)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/summary', async (req, reply) => {
  try {
    return await sessions.getSummary(req.params.id);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.get<{ Params: { id: string } }>('/sessions/:id/summary', async (req, reply) => {
  try {
    return await sessions.getSummary(req.params.id);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Paginated transcript read
app.get<{
  Params: { id: string };
  Querystring: { page?: string; limit?: string; role?: string };
}>('/v1/sessions/:id/transcript', async (req, reply) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const roleFilter = req.query.role as 'user' | 'assistant' | 'system' | undefined;
    return await sessions.readTranscript(req.params.id, page, limit, roleFilter);
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Screenshot capture (Issue #22)
app.post<{
  Params: { id: string };
  Body: { url?: string; fullPage?: boolean; width?: number; height?: number };
}>('/v1/sessions/:id/screenshot', async (req, reply) => {
  const { url, fullPage, width, height } = req.body || {};
  if (!url) return reply.status(400).send({ error: 'url is required' });

  // Validate session exists
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  if (!isPlaywrightAvailable()) {
    return reply.status(501).send({
      error: 'Playwright is not installed',
      message: 'Install Playwright to enable screenshots: npx playwright install chromium && npm install -D playwright',
    });
  }

  try {
    const result = await captureScreenshot({ url, fullPage, width, height });
    return reply.status(200).send(result);
  } catch (e: any) {
    return reply.status(500).send({ error: `Screenshot failed: ${e.message}` });
  }
});
app.post<{
  Params: { id: string };
  Body: { url?: string; fullPage?: boolean; width?: number; height?: number };
}>('/sessions/:id/screenshot', async (req, reply) => {
  const { url, fullPage, width, height } = req.body || {};
  if (!url) return reply.status(400).send({ error: 'url is required' });

  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  if (!isPlaywrightAvailable()) {
    return reply.status(501).send({
      error: 'Playwright is not installed',
      message: 'Install Playwright to enable screenshots: npx playwright install chromium && npm install -D playwright',
    });
  }

  try {
    const result = await captureScreenshot({ url, fullPage, width, height });
    return reply.status(200).send(result);
  } catch (e: any) {
    return reply.status(500).send({ error: `Screenshot failed: ${e.message}` });
  }
});

// SSE event stream (Issue #32)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/events', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial connected event
  reply.raw.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

  // Subscribe to session events
  const handler = (event: SessionSSEEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Connection closed
    }
  };

  const unsubscribe = eventBus.subscribe(req.params.id, handler);

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    try {
      reply.raw.write(`data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30_000);

  // Clean up on disconnect
  req.raw.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  // Don't let Fastify auto-send (we manage the response manually)
  await reply;
});
app.get<{ Params: { id: string } }>('/sessions/:id/events', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  reply.raw.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

  const handler = (event: SessionSSEEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch { /* connection closed */ }
  };

  const unsubscribe = eventBus.subscribe(req.params.id, handler);

  const heartbeat = setInterval(() => {
    try { reply.raw.write(`data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`); } catch { clearInterval(heartbeat); }
  }, 30_000);

  req.raw.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  await reply;
});

// ── Claude Code Hook Endpoints (Issue #161) ─────────────────────────

// POST /v1/sessions/:id/hooks/permission — PermissionRequest hook from CC
app.post<{
  Params: { id: string };
  Body: {
    session_id?: string;
    tool_name?: string;
    tool_input?: unknown;
    permission_mode?: string;
    hook_event_name?: string;
  };
}>('/v1/sessions/:id/hooks/permission', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const { tool_name, tool_input, permission_mode } = req.body;

  // Update session status
  session.status = 'permission_prompt';
  session.lastActivity = Date.now();
  await sessions.save();

  // Notify channels and SSE
  const detail = tool_name
    ? `Permission request: ${tool_name}${permission_mode ? ` (${permission_mode})` : ''}`
    : 'Permission requested';
  await channels.statusChange({
    event: 'status.permission',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir: session.workDir },
    detail,
    meta: { tool_name, tool_input, permission_mode },
  });
  eventBus.emitApproval(session.id, detail);

  return reply.status(200).send({});
});

// POST /v1/sessions/:id/hooks/stop — Stop hook from CC
app.post<{
  Params: { id: string };
  Body: {
    session_id?: string;
    stop_reason?: string;
    hook_event_name?: string;
  };
}>('/v1/sessions/:id/hooks/stop', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const { stop_reason } = req.body;

  // Update session status
  session.status = 'idle';
  session.lastActivity = Date.now();
  await sessions.save();

  // Notify channels and SSE
  const detail = stop_reason
    ? `Claude Code stopped: ${stop_reason}`
    : 'Claude Code session ended normally';
  await channels.statusChange({
    event: 'status.idle',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir: session.workDir },
    detail,
    meta: { stop_reason },
  });
  eventBus.emitStatus(session.id, 'idle', detail);

  return reply.status(200).send({});
});

// Batch create (Issue #36)
app.post<{ Body: { sessions: BatchSessionSpec[] } }>('/v1/sessions/batch', async (req, reply) => {
  const { sessions: specs } = req.body || {};
  if (!specs || !Array.isArray(specs) || specs.length === 0) {
    return reply.status(400).send({ error: 'sessions array is required' });
  }
  if (specs.some(s => !s.workDir)) {
    return reply.status(400).send({ error: 'Each session must have a workDir' });
  }
  const result = await pipelines.batchCreate(specs);
  return reply.status(201).send(result);
});

// Pipeline create (Issue #36)
app.post<{ Body: PipelineConfig }>('/v1/pipelines', async (req, reply) => {
  const config = req.body;
  if (!config?.name || !config?.stages || !Array.isArray(config.stages) || config.stages.length === 0) {
    return reply.status(400).send({ error: 'name and stages array are required' });
  }
  if (!config.workDir) {
    return reply.status(400).send({ error: 'workDir is required' });
  }
  try {
    const pipeline = await pipelines.createPipeline(config);
    return reply.status(201).send(pipeline);
  } catch (e: any) {
    return reply.status(400).send({ error: e.message });
  }
});

// Pipeline status
app.get<{ Params: { id: string } }>('/v1/pipelines/:id', async (req, reply) => {
  const pipeline = pipelines.getPipeline(req.params.id);
  if (!pipeline) return reply.status(404).send({ error: 'Pipeline not found' });
  return pipeline;
});

// List pipelines
app.get('/v1/pipelines', async () => pipelines.listPipelines());

// ── Session Reaper ──────────────────────────────────────────────────

async function reapStaleSessions(maxAgeMs: number): Promise<void> {
  const now = Date.now();
  for (const session of sessions.listSessions()) {
    const age = now - session.createdAt;
    if (age > maxAgeMs) {
    const ageMin = Math.round(age / 60000);
      console.log(
        `Reaper: killing session ${session.windowName} (${session.id.slice(0, 8)}) — age ${ageMin}min`,
      );
      try {
        await channels.sessionEnded({
          event: 'session.ended',
          timestamp: new Date().toISOString(),
          session: { id: session.id, name: session.windowName, workDir: session.workDir },
          detail: `Auto-killed: exceeded ${maxAgeMs / 3600000}h time limit`,
        });
        await sessions.killSession(session.id);
        monitor.removeSession(session.id);
      } catch (e) {
        console.error(`Reaper: failed to kill session ${session.id}:`, e);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Issue #20: Add actionHints to session response for interactive states. */
function addActionHints(session: import('./session.js').SessionInfo): Record<string, unknown> {
  const result: Record<string, unknown> = { ...session };
  if (session.status === 'permission_prompt' || session.status === 'bash_approval') {
    result.actionHints = {
      approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
      reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
    };
  }
  return result;
}

function makePayload(
  event: SessionEvent,
  sessionId: string,
  detail: string,
  meta?: Record<string, unknown>,
): SessionEventPayload {
  const session = sessions.getSession(sessionId);
  return {
    event,
    timestamp: new Date().toISOString(),
    session: {
      id: sessionId,
      name: session?.windowName || 'unknown',
      workDir: session?.workDir || '',
    },
    detail,
    ...(meta && { meta }),
  };
}

// ── Start ────────────────────────────────────────────────────────────

/** Register notification channels from config */
function registerChannels(cfg: Config): void {
  // Telegram (optional)
  if (cfg.tgBotToken && cfg.tgGroupId) {
    channels.register(new TelegramChannel({
      botToken: cfg.tgBotToken,
      groupChatId: cfg.tgGroupId,
    }));
  }

  // Webhooks (optional)
  if (cfg.webhooks.length > 0) {
    const webhookChannel = new WebhookChannel({
      endpoints: cfg.webhooks.map(url => ({ url })),
    });
    channels.register(webhookChannel);
  }
}

// ── PID file (peer Aegis detection) ───────────────────────────────────

let pidFilePath = '';

function writePidFile(): void {
  try {
    pidFilePath = path.join(config.stateDir, 'aegis.pid');
    writeFileSync(pidFilePath, String(process.pid));
  } catch { /* non-critical */ }
}


function readPidFile(): number | null {
  try {
    const p = path.join(config.stateDir, 'aegis.pid');
    const content = readFileSync(p, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// ── Port conflict recovery (Issue #99, #162) ──────────────────────────

/**
 * Check if a PID exists using `process.kill(pid, 0)`.
 */
function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a PID is an ancestor of the current process.
 */
function isAncestorPid(pid: number): boolean {
  try {
    let current = process.ppid;
    for (let depth = 0; depth < 10 && current > 1; depth++) {
      if (current === pid) return true;
      try {
        current = parseInt(readFileSync(`/proc/${current}/stat`, 'utf-8').split(' ')[1], 10);
      } catch {
        break;
      }
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Wait for a port to be released with exponential backoff.
 */
async function waitForPortRelease(port: number, maxWaitMs = 5_000): Promise<void> {
  const net = await import('node:net');
  const start = Date.now();
  let delay = 200;

  while (Date.now() - start < maxWaitMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.createServer();
        sock.once('error', reject);
        sock.listen(port, '127.0.0.1', () => {
          sock.close();
          reject(new Error('port free')); // signal success
        });
      });
    } catch (err: any) {
      if (err?.message === 'port free') return;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 1_000);
  }
}

/**
 * Kill stale process holding a port. Returns true if a process was killed.
 * Uses `lsof` to find the PID, verifies it exists, skips ancestors,
 * and tries SIGTERM before SIGKILL.
 */
async function killStalePortHolder(port: number): Promise<boolean> {
  // Small random delay to reduce race window with systemd restarts
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));

  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8', timeout: 5_000 }).trim();
    if (!output) return false;

    const pids = output.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (pids.length === 0) return false;

    let killed = false;

    for (const pid of pids) {
      // Skip own PID
      if (pid === process.pid) continue;

      // Skip ancestors to avoid killing parent process (e.g. systemd supervisor)
      if (isAncestorPid(pid)) {
        console.warn(`EADDRINUSE recovery: skipping ancestor PID ${pid} on port ${port}`);
        continue;
      }

      // Skip peer Aegis instance (another Aegis process that wrote the PID file)
      const pidFilePid = readPidFile();
      if (pidFilePid !== null && pid === pidFilePid && pid !== process.pid) {
        console.warn(`EADDRINUSE recovery: skipping peer Aegis PID ${pid} (PID file match) on port ${port}`);
        continue;
      }

      // Verify PID exists before attempting to kill
      if (!pidExists(pid)) continue;

      console.warn(`EADDRINUSE recovery: killing stale process PID ${pid} on port ${port}`);

      // Try SIGTERM first for graceful shutdown
      try {
        process.kill(pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 2_000));

        // Check if process exited after SIGTERM
        if (!pidExists(pid)) {
          killed = true;
          continue;
        }
      } catch { /* process may have already exited */ }

      // Fallback to SIGKILL if SIGTERM didn't work
      try {
        process.kill(pid, 'SIGKILL');
        killed = true;
      } catch { /* already dead */ }
    }

    if (killed) {
      await waitForPortRelease(port);
    }

    return killed;
  } catch {
    // lsof not found or no process on port — that's fine
    return false;
  }
}

/**
 * Listen with EADDRINUSE recovery: if port is taken, kill the stale holder and retry once.
 */
async function listenWithRetry(
  app: ReturnType<typeof Fastify>,
  port: number,
  host: string,
  maxRetries = 1,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await app.listen({ port, host });
      return;
    } catch (err: any) {
      if (err?.code !== 'EADDRINUSE' || attempt >= maxRetries) {
        throw err;
      }
      console.error(`EADDRINUSE on port ${port} — attempting recovery (attempt ${attempt + 1}/${maxRetries})`);
      const killed = await killStalePortHolder(port);
      if (!killed) {
        console.error(`EADDRINUSE recovery failed: no stale process found on port ${port}`);
        throw err;
      }
    }
  }
}

async function main(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Initialize core components with config
  tmux = new TmuxManager(config.tmuxSession);
  sessions = new SessionManager(tmux, config);
  monitor = new SessionMonitor(sessions, channels, { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 5000 });

  // Register channels
  registerChannels(config);

  // Setup auth (Issue #39: multi-key + backward compat)
  const { join } = await import('node:path');
  auth = new AuthManager(join(config.stateDir, 'keys.json'), config.authToken);
  await auth.load();
  setupAuth(auth);

  // Register WebSocket plugin for live terminal streaming (Issue #108)
  await app.register(fastifyWebsocket);
  registerWsTerminalRoute(app, sessions, tmux);

  // Load persisted sessions
  await sessions.load();
  await tmux.ensureSession();

  // Initialize channels
  await channels.init(handleInbound);

  // Wire SSE event bus (Issue #32)
  monitor.setEventBus(eventBus);

  // Issue #84: Wire JSONL watcher for fs.watch-based message detection
  jsonlWatcher = new JsonlWatcher();
  monitor.setJsonlWatcher(jsonlWatcher);

  // Start watching JSONL files for already-discovered sessions
  for (const session of sessions.listSessions()) {
    if (session.jsonlPath) {
      jsonlWatcher.watch(session.id, session.jsonlPath, session.monitorOffset);
    }
  }

  // Register HTTP hook receiver (Issue #169, Issue #87: pass metrics for latency tracking)
  registerHookRoutes(app, { sessions, eventBus, metrics });

  // Initialize pipeline manager (Issue #36)
  pipelines = new PipelineManager(sessions, eventBus);

  // Initialize metrics (Issue #40)
  metrics = new MetricsCollector(join(config.stateDir, 'metrics.json'));
  await metrics.load();
  process.on('SIGTERM', async () => { await metrics.save(); process.exit(0); });
  process.on('SIGINT', async () => { await metrics.save(); process.exit(0); });

  // Start monitor
  monitor.start();

  // Issue #81: Start swarm monitor for agent swarm awareness
  swarmMonitor = new SwarmMonitor(sessions);
  swarmMonitor.onEvent((event) => {
    if (!event.swarm.parentSession) return;
    const parentId = event.swarm.parentSession.id;
    const teammate = event.teammate;

    if (event.type === 'teammate_spawned') {
      const detail = `🔧 Teammate ${teammate.windowName} spawned`;
      eventBus.emit(parentId, {
        event: 'subagent_start',
        sessionId: parentId,
        timestamp: new Date().toISOString(),
        data: { teammate: teammate.windowName, windowId: teammate.windowId },
      });
      channels.swarmEvent(makePayload('swarm.teammate_spawned', parentId, detail, {
        teammateName: teammate.windowName,
        teammateWindowId: teammate.windowId,
        teammateCwd: teammate.cwd,
      }));
    } else if (event.type === 'teammate_finished') {
      const detail = `✅ Teammate ${teammate.windowName} finished`;
      eventBus.emit(parentId, {
        event: 'subagent_stop',
        sessionId: parentId,
        timestamp: new Date().toISOString(),
        data: { teammate: teammate.windowName },
      });
      channels.swarmEvent(makePayload('swarm.teammate_finished', parentId, detail, {
        teammateName: teammate.windowName,
      }));
    }
  });
  swarmMonitor.start();

  // Issue #71: Wire swarm monitor into Telegram channel for /swarm command
  for (const ch of channels.getChannels()) {
    if ('setSwarmMonitor' in ch && typeof (ch as { setSwarmMonitor: unknown }).setSwarmMonitor === 'function') {
      (ch as TelegramChannel).setSwarmMonitor(swarmMonitor);
    }
  }

  // Start reaper
  setInterval(() => reapStaleSessions(config.maxSessionAgeMs), config.reaperIntervalMs);
  console.log(
    `Session reaper active: max age ${config.maxSessionAgeMs / 3600000}h, check every ${config.reaperIntervalMs / 60000}min`,
  );


  // #127: Serve dashboard static files (Issue #105) — graceful if missing
  const dashboardRoot = path.join(__dirname, "..", "dashboard", "dist");
  let dashboardAvailable = false;
  try {
    await fs.access(dashboardRoot);
    dashboardAvailable = true;
  } catch {
    console.warn("Dashboard directory not found — skipping dashboard serving. Run 'npm run build:dashboard' to enable.");
  }

  if (dashboardAvailable) {
    await app.register(fastifyStatic, {
      root: dashboardRoot,
      prefix: "/dashboard/",
      // #146: Cache hashed assets aggressively, no-cache for index.html
      setHeaders: (reply, pathname) => {
        // Security headers (#145)
        reply.setHeader('X-Frame-Options', 'DENY');
        reply.setHeader('X-Content-Type-Options', 'nosniff');
        reply.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // Cache control (#146)
        if (pathname === '/index.html' || pathname === '/') {
          reply.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          reply.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
      },
    });
  }

  // SPA fallback for dashboard routes (Issue #105)
  app.setNotFoundHandler(async (req, reply) => {
    if (dashboardAvailable && (req.url === "/dashboard" || req.url?.startsWith("/dashboard/") || req.url?.startsWith("/dashboard?"))) {
      return reply.sendFile("index.html", dashboardRoot);
    }
    return reply.status(404).send({ error: "Not found" });
  });
  await listenWithRetry(app, config.port, config.host);
  writePidFile();
  console.log(`Aegis running on http://${config.host}:${config.port}`);
  console.log(`Channels: ${channels.count} registered`);
  console.log(`State dir: ${config.stateDir}`);
  console.log(`Claude projects dir: ${config.claudeProjectsDir}`);
  if (config.authToken) console.log('Auth: Bearer token required');
}

main().catch(err => {
  console.error('Failed to start Aegis:', err);
  process.exit(1);
});
