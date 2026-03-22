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
import { TmuxManager } from './tmux.js';
import { SessionManager } from './session.js';
import { SessionMonitor } from './monitor.js';
import {
  ChannelManager,
  TelegramChannel,
  WebhookChannel,
  type InboundCommand,
  type SessionEventPayload,
} from './channels/index.js';
import { loadConfig, type Config } from './config.js';
import { captureScreenshot, isPlaywrightAvailable } from './screenshot.js';
import { SessionEventBus, type SessionSSEEvent } from './events.js';
import { PipelineManager, type BatchSessionSpec, type PipelineConfig } from './pipeline.js';
import { AuthManager } from './auth.js';

// ── Configuration ────────────────────────────────────────────────────

// Config loaded at startup; env vars override file values
let config: Config;

// These will be initialized after config is loaded
let tmux: TmuxManager;
let sessions: SessionManager;
let monitor: SessionMonitor;
const channels = new ChannelManager();
const eventBus = new SessionEventBus();
let pipelines: PipelineManager;
let auth: AuthManager;

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
    // Skip auth for health endpoint and auth key management bootstrap
    if (req.url === '/health' || req.url === '/v1/health') return;

    // If no auth configured (no master token, no keys), allow all
    if (!authManager.authEnabled) return;

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    const token = header.slice(7);
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
app.get('/v1/health', async () => ({
  status: 'ok',
  version: '1.0.0',
  uptime: process.uptime(),
  sessions: sessions.listSessions().length,
  channels: channels.count,
}));

// Backwards compat: unversioned health
app.get('/health', async () => ({
  status: 'ok',
  version: '1.0.0',
  uptime: process.uptime(),
  sessions: sessions.listSessions().length,
  channels: channels.count,
}));

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

// List sessions
app.get('/v1/sessions', async () => sessions.listSessions());
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
    autoApprove?: boolean;
  };
}>('/v1/sessions', async (req, reply) => {
  const { workDir, name, prompt, resumeSessionId, claudeCommand, env, stallThresholdMs, autoApprove } = req.body;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  const session = await sessions.createSession({ workDir, name, resumeSessionId, claudeCommand, env, stallThresholdMs, autoApprove });

  // If a prompt was provided, wait for CC to be ready and send it
  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  if (prompt) {
    promptDelivery = await sessions.sendInitialPrompt(session.id, prompt);
  }

  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}${prompt ? (promptDelivery?.delivered ? ' (prompt delivered)' : ' (prompt FAILED)') : ''}`,
  });

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
    autoApprove?: boolean;
  };
}>('/sessions', async (req, reply) => {
  const { workDir, name, prompt, resumeSessionId, claudeCommand, env, stallThresholdMs, autoApprove } = req.body;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  const session = await sessions.createSession({ workDir, name, resumeSessionId, claudeCommand, env, stallThresholdMs, autoApprove });

  let promptDelivery: { delivered: boolean; attempts: number } | undefined;
  if (prompt) {
    promptDelivery = await sessions.sendInitialPrompt(session.id, prompt);
  }

  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}${prompt ? (promptDelivery?.delivered ? ' (prompt delivered)' : ' (prompt FAILED)') : ''}`,
  });

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
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.post<{ Params: { id: string } }>('/sessions/:id/approve', async (req, reply) => {
  try {
    await sessions.approve(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});

// Reject
app.post<{ Params: { id: string } }>('/v1/sessions/:id/reject', async (req, reply) => {
  try {
    await sessions.reject(req.params.id);
    return { ok: true };
  } catch (e: any) {
    return reply.status(404).send({ error: e.message });
  }
});
app.post<{ Params: { id: string } }>('/sessions/:id/reject', async (req, reply) => {
  try {
    await sessions.reject(req.params.id);
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
      reply.raw.write(`: heartbeat\n\n`);
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
    try { reply.raw.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); }
  }, 30_000);

  req.raw.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  await reply;
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

function makePayload(event: 'session.ended', sessionId: string, detail: string): SessionEventPayload {
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

async function main(): Promise<void> {
  // Load configuration
  config = await loadConfig();

  // Initialize core components with config
  tmux = new TmuxManager(config.tmuxSession);
  sessions = new SessionManager(tmux, config);
  monitor = new SessionMonitor(sessions, channels);

  // Register channels
  registerChannels(config);

  // Setup auth (Issue #39: multi-key + backward compat)
  const { join } = await import('node:path');
  auth = new AuthManager(join(config.stateDir, 'keys.json'), config.authToken);
  await auth.load();
  setupAuth(auth);

  // Load persisted sessions
  await sessions.load();
  await tmux.ensureSession();

  // Initialize channels
  await channels.init(handleInbound);

  // Wire SSE event bus (Issue #32)
  monitor.setEventBus(eventBus);

  // Initialize pipeline manager (Issue #36)
  pipelines = new PipelineManager(sessions, eventBus);

  // Start monitor
  monitor.start();

  // Start reaper
  setInterval(() => reapStaleSessions(config.maxSessionAgeMs), config.reaperIntervalMs);
  console.log(
    `Session reaper active: max age ${config.maxSessionAgeMs / 3600000}h, check every ${config.reaperIntervalMs / 60000}min`,
  );

  await app.listen({ port: config.port, host: config.host });
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
