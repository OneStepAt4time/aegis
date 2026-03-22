/**
 * server.ts — HTTP API server for Manus.
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

// ── Configuration ────────────────────────────────────────────────────

// Config loaded at startup; env vars override file values
let config: Config;

// These will be initialized after config is loaded
let tmux: TmuxManager;
let sessions: SessionManager;
let monitor: SessionMonitor;
const channels = new ChannelManager();

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

// Auth middleware setup (called after config is loaded)
function setupAuth(authToken: string): void {
  if (!authToken) return;
  app.addHook('onRequest', async (req, reply) => {
    // Skip auth for health endpoint
    if (req.url === '/health' || req.url === '/v1/health') return;

    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${authToken}`) {
      return reply.status(401).send({ error: 'Unauthorized' });
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

// List sessions
app.get('/v1/sessions', async () => sessions.listSessions());
app.get('/sessions', async () => sessions.listSessions());

// Create session
app.post<{
  Body: {
    workDir: string;
    name?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
  };
}>('/v1/sessions', async (req, reply) => {
  const { workDir, name, resumeSessionId, claudeCommand, env } = req.body;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  const session = await sessions.createSession({ workDir, name, resumeSessionId, claudeCommand, env });

  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}`,
  });

  return reply.status(201).send(session);
});

// Backwards compat
app.post<{
  Body: {
    workDir: string;
    name?: string;
    resumeSessionId?: string;
    claudeCommand?: string;
    env?: Record<string, string>;
  };
}>('/sessions', async (req, reply) => {
  const { workDir, name, resumeSessionId, claudeCommand, env } = req.body;
  if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

  const session = await sessions.createSession({ workDir, name, resumeSessionId, claudeCommand, env });

  await channels.sessionCreated({
    event: 'session.created',
    timestamp: new Date().toISOString(),
    session: { id: session.id, name: session.windowName, workDir },
    detail: `Session created: ${session.windowName}`,
  });

  return reply.status(201).send(session);
});

// Get session
app.get<{ Params: { id: string } }>('/v1/sessions/:id', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  return session;
});
app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  return session;
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

  // Setup auth if configured
  setupAuth(config.authToken);

  // Load persisted sessions
  await sessions.load();
  await tmux.ensureSession();

  // Initialize channels
  await channels.init(handleInbound);

  // Start monitor
  monitor.start();

  // Start reaper
  setInterval(() => reapStaleSessions(config.maxSessionAgeMs), config.reaperIntervalMs);
  console.log(
    `Session reaper active: max age ${config.maxSessionAgeMs / 3600000}h, check every ${config.reaperIntervalMs / 60000}min`,
  );

  await app.listen({ port: config.port, host: config.host });
  console.log(`Manus running on http://${config.host}:${config.port}`);
  console.log(`Channels: ${channels.count} registered`);
  console.log(`State dir: ${config.stateDir}`);
  console.log(`Claude projects dir: ${config.claudeProjectsDir}`);
  if (config.authToken) console.log('Auth: Bearer token required');
}

main().catch(err => {
  console.error('Failed to start Manus:', err);
  process.exit(1);
});
