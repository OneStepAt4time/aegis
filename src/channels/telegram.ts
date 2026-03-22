/**
 * channels/telegram.ts — Telegram notification channel.
 *
 * Creates one topic per CC session in a Telegram supergroup.
 * Bidirectional: reads replies from topics and fires inbound commands.
 *
 * Formatting: HTML parse_mode with structured, clean messages.
 */

import type {
  Channel,
  SessionEventPayload,
  InboundHandler,
} from './types.js';

export interface TelegramChannelConfig {
  botToken: string;
  groupChatId: string;
}

interface SessionTopic {
  sessionId: string;
  topicId: number;
  windowName: string;
}

interface SessionProgress {
  totalMessages: number;
  reads: number;
  edits: number;
  creates: number;
  commands: number;
  searches: number;
  errors: number;
  filesRead: string[];
  filesEdited: string[];
  startedAt: number;
  lastMessage: string;
  currentStatus: string;
}

interface QueuedItem {
  text: string;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
}

// Global rate limit state for Telegram API
let rateLimitUntil = 0;

/** Call Telegram Bot API with retry on 429. */
async function tgApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
  retries = 3,
): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const now = Date.now();
    if (rateLimitUntil > now) {
      const waitMs = rateLimitUntil - now;
      console.log(`Telegram rate limit: waiting ${Math.ceil(waitMs / 1000)}s before ${method}`);
      await sleep(waitMs);
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as {
      ok: boolean;
      result?: unknown;
      description?: string;
      parameters?: { retry_after?: number };
    };

    if (data.ok) return data.result;

    if (res.status === 429 && data.parameters?.retry_after) {
      const retryAfter = data.parameters.retry_after;
      rateLimitUntil = Date.now() + retryAfter * 1000 + 500;
      console.log(
        `Telegram 429: retry_after=${retryAfter}s, attempt ${attempt + 1}/${retries + 1}`,
      );
      if (attempt < retries) {
        await sleep(retryAfter * 1000 + 500);
        continue;
      }
    }

    if (attempt === retries) {
      throw new Error(`Telegram API ${method}: ${data.description || 'unknown error'}`);
    }
    await sleep(1000 * (attempt + 1));
  }
  throw new Error('Unreachable');
}

// ── HTML Helpers ────────────────────────────────────────────────────────────

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bold(text: string): string {
  return `<b>${esc(text)}</b>`;
}

function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

function italic(text: string): string {
  return `<i>${esc(text)}</i>`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortPath(path: string): string {
  // Keep only filename or last 2 segments
  const parts = path.replace(/^\//, '').split('/');
  if (parts.length <= 2) return parts.join('/');
  return '…/' + parts.slice(-2).join('/');
}

// ── Message Formatting ──────────────────────────────────────────────────────

function formatSessionCreated(name: string, workDir: string, id: string, meta?: Record<string, unknown>): string {
  const shortId = id.slice(0, 8);
  const shortDir = workDir.replace(/^\/home\/[^/]+\/projects\//, '~/');
  const lines = [
    `🚀 <b>Session Started</b>`,
    ``,
    `📛 ${bold(name)}`,
    `📁 ${code(shortDir)}`,
    `🆔 ${code(shortId)}`,
  ];
  if (meta?.autoApprove) lines.push(`✅ Auto-approve: ON`);
  if (meta?.model) lines.push(`🧠 Model: ${code(String(meta.model))}`);
  if (meta?.prompt) {
    const promptPreview = truncate(String(meta.prompt), 200);
    lines.push(``);
    lines.push(`📝 ${italic(esc(promptPreview))}`);
  }
  return lines.join('\n');
}

function formatSessionEnded(name: string, detail: string, progress: SessionProgress): string {
  const duration = elapsed(Date.now() - progress.startedAt);
  const stats: string[] = [];
  if (progress.reads) stats.push(`📖 ${progress.reads} reads`);
  if (progress.edits) stats.push(`✏️ ${progress.edits} edits`);
  if (progress.creates) stats.push(`📝 ${progress.creates} creates`);
  if (progress.commands) stats.push(`💻 ${progress.commands} cmds`);
  if (progress.errors) stats.push(`❌ ${progress.errors} errors`);

  const lines = [
    `🏁 <b>Session Complete</b>`,
    ``,
    `⏱ ${duration}  ·  ${progress.totalMessages} messages`,
  ];
  if (stats.length > 0) {
    lines.push(stats.join('  ·  '));
  }
  if (progress.filesEdited.length > 0) {
    const files = progress.filesEdited.slice(0, 5).map(f => code(shortPath(f))).join(', ');
    const extra = progress.filesEdited.length > 5 ? ` +${progress.filesEdited.length - 5} more` : '';
    lines.push(`📂 ${files}${extra}`);
  }
  if (detail) lines.push(`\n${esc(truncate(detail, 120))}`);
  return lines.join('\n');
}

function formatAssistantMessage(detail: string): string | null {
  const text = detail.trim();
  if (!text) return null;

  // Skip filler lines but keep meaningful content
  const allLines = text.split('\n');
  const lines = allLines.filter(l => {
    const t = l.trim();
    return t && !t.match(/^(Let me|I'll|Sure,|Okay,|Alright,|Great,|Now I)/i);
  });

  const firstLine = lines[0] || text;

  // Helper: preserve multi-line structure (up to maxLines), respecting maxChars
  const multiLine = (maxLines: number, maxChars: number): string => {
    const selected = lines.slice(0, maxLines);
    const joined = selected.map(l => esc(l)).join('\n');
    if (joined.length <= maxChars) return joined;
    return esc(truncate(lines.slice(0, maxLines).join('\n'), maxChars));
  };

  // Plan/approach — show structure (up to 10 lines, 800 chars)
  if (/^(plan|steps?|approach|here's (how|what|the plan)|my approach)/im.test(firstLine)) {
    return `📋 ${bold('Plan')}\n\n${multiLine(10, 800)}`;
  }

  // Question — up to 3 lines, 500 chars
  if (/\?$/.test(firstLine) || /^(what|how|why|when|where|should|can you|do you|is there)/im.test(firstLine)) {
    return `❓ ${italic(multiLine(3, 500))}`;
  }

  // Announcing code changes — up to 5 lines, 500 chars
  if (/^(writing|implementing|adding|creating|updating|fixing|refactor)/im.test(firstLine)) {
    return `✏️ ${multiLine(5, 500)}`;
  }

  // Analysis/reading — up to 5 lines, 500 chars
  if (/^(reading|examining|looking at|checking|analyzing|inspecting|reviewing)/im.test(firstLine)) {
    return `🔍 ${multiLine(5, 500)}`;
  }

  // Summary/conclusion — up to 10 lines, 800 chars
  if (/^(summary|done|complete|finished|all (tests|checks)|build (pass|succeed)|here (is|are) the)/im.test(firstLine)) {
    return `✅ ${multiLine(10, 800)}`;
  }

  // Default: up to 5 lines, 500 chars
  return `💬 ${multiLine(5, 500)}`;
}

interface ToolInfo {
  icon: string;
  label: string;
  file?: string;
  cmd?: string;
  category: 'read' | 'edit' | 'create' | 'search' | 'command' | 'other';
}

function parseToolUse(detail: string): ToolInfo {
  const d = detail.trim();

  // Read file
  const readMatch = d.match(/^Read[:\s]+(.+)/im);
  if (readMatch) return { icon: '📖', label: `Reading ${shortPath(readMatch[1].trim())}`, file: readMatch[1].trim(), category: 'read' };

  // Edit file
  const editMatch = d.match(/^Edit[:\s]+(.+)/im);
  if (editMatch) return { icon: '✏️', label: `Editing ${shortPath(editMatch[1].trim())}`, file: editMatch[1].trim(), category: 'edit' };

  // Write/Create file
  const writeMatch = d.match(/^Write[:\s]+(.+)/im);
  if (writeMatch) return { icon: '📝', label: `Creating ${shortPath(writeMatch[1].trim())}`, file: writeMatch[1].trim(), category: 'create' };

  // Search/Grep/Glob
  const searchMatch = d.match(/^(Search|Grep|Glob)[:\s]+["']?(.+?)["']?$/im);
  if (searchMatch) return { icon: '🔍', label: `Searching: ${truncate(searchMatch[2], 50)}`, category: 'search' };

  // Bash/Run
  const bashMatch = d.match(/^(Bash|Run)[:\s]+(.+)$/im);
  if (bashMatch) {
    const cmd = bashMatch[2].trim();
    return { icon: '💻', label: truncate(cmd, 70), cmd, category: 'command' };
  }

  // List
  const listMatch = d.match(/^List(ing|Dir)?[:\s]*(.+)$/im);
  if (listMatch) return { icon: '📂', label: `Listing ${shortPath(listMatch[2].trim())}`, category: 'read' };

  // Generic
  const toolName = d.split(/[:(\s]/)[0] || 'Tool';
  return { icon: '🔧', label: toolName, category: 'other' };
}

function formatToolResult(detail: string): { text: string; isError: boolean } | null {
  // Success → silent
  if (/^(success|ok|done|completed|passed)$/im.test(detail.trim())) return null;

  // Build output
  if (/build|compil|tsc/i.test(detail)) {
    if (/error|failed/i.test(detail)) {
      const errorLine = detail.split('\n').find(l => /error/i.test(l)) || '';
      return {
        text: `🏗️ ${bold('Build Failed')}\n${code(truncate(errorLine, 120))}`,
        isError: true,
      };
    }
    return { text: `🏗️ ${bold('Build')}  ✅`, isError: false };
  }

  // Test output
  if (/test|spec|vitest|jest/i.test(detail)) {
    const passedMatch = detail.match(/(\d+)\s*(passed|passing)/i);
    const failedMatch = detail.match(/(\d+)\s*(failed|failing)/i);

    if (failedMatch && parseInt(failedMatch[1]) > 0) {
      return {
        text: `🧪 ${bold('Tests')}  ❌ ${failedMatch[1]} failed`,
        isError: true,
      };
    }
    if (passedMatch) {
      return { text: `🧪 ${bold('Tests')}  ✅ ${passedMatch[1]} passed`, isError: false };
    }
  }

  // Lint
  if (/lint|eslint|prettier/i.test(detail)) {
    if (/error|warning|failed/i.test(detail)) {
      const count = detail.match(/(\d+)\s*(error|warning)/i);
      return {
        text: `🔎 ${bold('Lint')}  ⚠️ ${count ? count[0] : 'issues found'}`,
        isError: true,
      };
    }
    return null; // lint success → silent
  }

  // Error — show more context with <pre> for multi-line
  if (/error|failed|exception|ENOENT|EACCES|ERR_/i.test(detail)) {
    const errorLines = detail.split('\n').filter(l => l.trim()).slice(0, 5);
    const errorText = errorLines.join('\n');
    if (errorLines.length > 1) {
      return {
        text: `❌ <b>Error</b>\n<pre>${esc(truncate(errorText, 500))}</pre>`,
        isError: true,
      };
    }
    return {
      text: `❌ ${code(truncate(errorText, 300))}`,
      isError: true,
    };
  }

  // Non-trivial output with code — use <pre>
  if (detail.includes('\n') && detail.length > 100) {
    const preview = detail.split('\n').slice(0, 6).join('\n');
    return {
      text: `📄 <pre>${esc(truncate(preview, 500))}</pre>`,
      isError: false,
    };
  }

  return null; // Success → silent
}

function formatProgressCard(progress: SessionProgress, status?: string, lastMessage?: string): string {
  const duration = elapsed(Date.now() - progress.startedAt);
  const parts: string[] = [];

  parts.push(`📊 <b>Progress</b>  ·  ${duration}`);
  if (status) parts.push(`Status: ${bold(status)}`);
  parts.push(``);

  const counters: string[] = [];
  if (progress.reads) counters.push(`📖 ${progress.reads}`);
  if (progress.edits) counters.push(`✏️ ${progress.edits}`);
  if (progress.creates) counters.push(`📝 ${progress.creates}`);
  if (progress.commands) counters.push(`💻 ${progress.commands}`);
  if (progress.searches) counters.push(`🔍 ${progress.searches}`);

  if (counters.length > 0) {
    parts.push(counters.join('  ·  '));
  }

  if (progress.filesEdited.length > 0) {
    parts.push(``);
    parts.push(`${bold('Files changed:')}`);
    for (const f of progress.filesEdited.slice(0, 6)) {
      parts.push(`  • ${code(shortPath(f))}`);
    }
    if (progress.filesEdited.length > 6) {
      parts.push(`  • ${italic(`+${progress.filesEdited.length - 6} more`)}`);
    }
  }

  if (lastMessage) {
    parts.push(``);
    parts.push(`${bold('Last:')} ${esc(truncate(lastMessage, 200))}`);
  }

  return parts.join('\n');
}

// ── Telegram Channel ────────────────────────────────────────────────────────

export class TelegramChannel implements Channel {
  readonly name = 'telegram';

  private topics = new Map<string, SessionTopic>();
  private progress = new Map<string, SessionProgress>();
  private pollOffset = 0;
  private polling = false;
  private onInbound: InboundHandler | null = null;

  // Rate limiting & batching
  private messageQueue = new Map<string, QueuedItem[]>();
  private lastSent = new Map<string, number>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private pendingTool = new Map<string, ToolInfo>();

  // Group consecutive reads
  private pendingReads = new Map<string, string[]>();
  private readTimer = new Map<string, NodeJS.Timeout>();

  constructor(private config: TelegramChannelConfig) {}

  async init(onInbound: InboundHandler): Promise<void> {
    this.onInbound = onInbound;
    this.polling = true;
    this.pollLoop(); // fire-and-forget
    console.log(`Telegram channel: polling started, group ${this.config.groupChatId}`);
  }

  async destroy(): Promise<void> {
    this.polling = false;
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    for (const timer of this.readTimer.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.readTimer.clear();
  }

  async onSessionCreated(payload: SessionEventPayload): Promise<void> {
    const topicName = `🤖 ${payload.session.name}`;
    const result = (await tgApi(this.config.botToken, 'createForumTopic', {
      chat_id: this.config.groupChatId,
      name: topicName,
    })) as { message_thread_id: number };

    const topicId = result.message_thread_id;
    this.topics.set(payload.session.id, {
      sessionId: payload.session.id,
      topicId,
      windowName: payload.session.name,
    });

    this.progress.set(payload.session.id, {
      totalMessages: 0,
      reads: 0,
      edits: 0,
      creates: 0,
      commands: 0,
      searches: 0,
      errors: 0,
      filesRead: [],
      filesEdited: [],
      startedAt: Date.now(),
      lastMessage: '',
      currentStatus: 'starting',
    });

    await this.sendImmediate(
      payload.session.id,
      formatSessionCreated(payload.session.name, payload.session.workDir, payload.session.id, payload.meta),
    );
  }

  async onSessionEnded(payload: SessionEventPayload): Promise<void> {
    // Flush pending reads
    await this.flushReads(payload.session.id);
    await this.flushQueue(payload.session.id);

    const progress = this.progress.get(payload.session.id);
    if (progress) {
      await this.sendImmediate(
        payload.session.id,
        formatSessionEnded(payload.session.name, payload.detail, progress),
      );
    } else {
      await this.sendImmediate(payload.session.id, `🏁 ${bold('Session ended')}`);
    }

    this.cleanup(payload.session.id);
  }

  async onMessage(payload: SessionEventPayload): Promise<void> {
    const progress = this.progress.get(payload.session.id);
    if (progress) progress.totalMessages++;

    switch (payload.event) {
      case 'message.user':
        await this.flushReads(payload.session.id);
        await this.queueMessage(payload.session.id, `👤 ${bold('User')}  ${esc(truncate(payload.detail, 200))}`, 'high');
        break;

      case 'message.assistant': {
        if (progress) progress.lastMessage = truncate(payload.detail, 300);
        const formatted = formatAssistantMessage(payload.detail);
        if (formatted) {
          await this.queueMessage(payload.session.id, formatted, 'normal');
        }
        break;
      }

      case 'message.thinking':
        // Completely silent — no thinking noise
        break;

      case 'message.tool_use': {
        const tool = parseToolUse(payload.detail);
        this.pendingTool.set(payload.session.id, tool);

        if (progress) {
          switch (tool.category) {
            case 'read': progress.reads++; if (tool.file) progress.filesRead.push(tool.file); break;
            case 'edit': progress.edits++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
            case 'create': progress.creates++; if (tool.file && !progress.filesEdited.includes(tool.file)) progress.filesEdited.push(tool.file); break;
            case 'search': progress.searches++; break;
            case 'command': progress.commands++; break;
          }
        }
        break;
      }

      case 'message.tool_result': {
        const tool = this.pendingTool.get(payload.session.id);
        this.pendingTool.delete(payload.session.id);

        const result = formatToolResult(payload.detail);

        if (result) {
          // Has result to show (error, build, test)
          await this.flushReads(payload.session.id);
          if (result.isError && progress) progress.errors++;
          await this.queueMessage(payload.session.id, result.text, result.isError ? 'high' : 'normal');
        } else if (tool) {
          // Success → show the tool action grouped with consecutive reads
          if (tool.category === 'read' && tool.file) {
            this.addPendingRead(payload.session.id, tool.file);
          } else {
            await this.flushReads(payload.session.id);
            await this.queueMessage(
              payload.session.id,
              `${tool.icon} ${esc(tool.label)}`,
              'low',
            );
          }
        }
        break;
      }
    }

    // Progress card every 15 messages
    if (progress && progress.totalMessages > 0 && progress.totalMessages % 15 === 0) {
      await this.flushReads(payload.session.id);
      await this.queueMessage(
        payload.session.id,
        formatProgressCard(progress, progress.currentStatus, progress.lastMessage),
        'normal',
      );
    }
  }

  async onStatusChange(payload: SessionEventPayload): Promise<void> {
    // Track current status for progress cards
    const progress = this.progress.get(payload.session.id);
    const statusName = payload.event.replace('status.', '');
    if (progress) progress.currentStatus = statusName;

    switch (payload.event) {
      case 'status.permission':
        await this.flushReads(payload.session.id);
        await this.flushQueue(payload.session.id);
        await this.sendImmediate(
          payload.session.id,
          [
            `⚠️ ${bold('Permission Required')}`,
            ``,
            `<pre>${esc(truncate(payload.detail, 600))}</pre>`,
            ``,
            `Reply ${code('approve')} or ${code('reject')}`,
          ].join('\n'),
        );
        break;

      case 'status.idle':
        if (payload.detail && payload.detail.length > 10) {
          await this.queueMessage(
            payload.session.id,
            `✅ ${bold('Idle')}  ${esc(truncate(payload.detail, 120))}`,
            'low',
          );
        }
        break;

      case 'status.working':
        // Silent
        break;

      case 'status.question':
        await this.flushReads(payload.session.id);
        await this.flushQueue(payload.session.id);
        await this.sendImmediate(
          payload.session.id,
          `❓ ${bold('Question')}\n\n${italic(esc(truncate(payload.detail, 500)))}`,
        );
        break;

      case 'status.plan':
        await this.flushReads(payload.session.id);
        await this.flushQueue(payload.session.id);
        await this.sendImmediate(
          payload.session.id,
          [
            `📋 ${bold('Plan Proposed')}`,
            ``,
            esc(truncate(payload.detail, 800)),
            ``,
            `Reply ${code('approve')} or ${code('reject')}`,
          ].join('\n'),
        );
        break;
    }
  }

  // ── Read grouping ─────────────────────────────────────────────────────────

  private addPendingRead(sessionId: string, file: string): void {
    if (!this.pendingReads.has(sessionId)) {
      this.pendingReads.set(sessionId, []);
    }
    this.pendingReads.get(sessionId)!.push(file);

    // Flush after 4 seconds to batch consecutive reads
    const existing = this.readTimer.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.flushReads(sessionId), 4000);
    this.readTimer.set(sessionId, timer);
  }

  private async flushReads(sessionId: string): Promise<void> {
    const timer = this.readTimer.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.readTimer.delete(sessionId);
    }

    const files = this.pendingReads.get(sessionId);
    if (!files || files.length === 0) return;
    this.pendingReads.delete(sessionId);

    if (files.length === 1) {
      await this.queueMessage(sessionId, `📖 Reading ${code(shortPath(files[0]))}`, 'low');
    } else {
      const listed = files.slice(0, 8).map(f => code(shortPath(f))).join(', ');
      const extra = files.length > 8 ? ` +${files.length - 8} more` : '';
      await this.queueMessage(
        sessionId,
        `📖 Reading ${bold(String(files.length))} files: ${listed}${extra}`,
        'low',
      );
    }
  }

  // ── Send / Queue ──────────────────────────────────────────────────────────

  private async sendImmediate(sessionId: string, text: string): Promise<number | null> {
    await this.flushQueue(sessionId);
    return this.sendToTopic(sessionId, text);
  }

  private async sendToTopic(sessionId: string, text: string): Promise<number | null> {
    const topic = this.topics.get(sessionId);
    if (!topic) return null;

    const truncated = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text;

    // Rate limit: 3s between messages per session
    const lastSent = this.lastSent.get(sessionId) || 0;
    const now = Date.now();
    const waitMs = Math.max(0, 3000 - (now - lastSent));
    if (waitMs > 0) await sleep(waitMs);

    // Try HTML first, fallback to plain text
    try {
      const result = (await tgApi(this.config.botToken, 'sendMessage', {
        chat_id: this.config.groupChatId,
        message_thread_id: topic.topicId,
        text: truncated,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      })) as { message_id: number };
      this.lastSent.set(sessionId, Date.now());
      return result.message_id;
    } catch {
      // Fallback: strip HTML, send plain
      try {
        const plain = truncated.replace(/<[^>]+>/g, '');
        const result = (await tgApi(this.config.botToken, 'sendMessage', {
          chat_id: this.config.groupChatId,
          message_thread_id: topic.topicId,
          text: plain,
          disable_web_page_preview: true,
        })) as { message_id: number };
        this.lastSent.set(sessionId, Date.now());
        return result.message_id;
      } catch (e) {
        console.error(`Telegram: failed to send to topic ${topic.topicId}:`, e);
        return null;
      }
    }
  }

  private async queueMessage(
    sessionId: string,
    text: string,
    priority: QueuedItem['priority'],
  ): Promise<void> {
    if (!this.messageQueue.has(sessionId)) {
      this.messageQueue.set(sessionId, []);
    }
    this.messageQueue.get(sessionId)!.push({ text, priority, timestamp: Date.now() });

    // High priority: flush immediately
    if (priority === 'high') {
      await this.flushQueue(sessionId);
      return;
    }

    // Normal/low: batch for 3 seconds
    if (!this.flushTimers.has(sessionId)) {
      const timer = setTimeout(() => this.flushQueue(sessionId), 3000);
      this.flushTimers.set(sessionId, timer);
    }
  }

  private async flushQueue(sessionId: string): Promise<void> {
    const timer = this.flushTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(sessionId);
    }

    const items = this.messageQueue.get(sessionId);
    if (!items || items.length === 0) return;
    this.messageQueue.delete(sessionId);

    // Group low-priority items together, send high/normal separately
    const groups: string[] = [];
    let lowBatch: string[] = [];

    for (const item of items) {
      if (item.priority === 'low') {
        lowBatch.push(item.text);
      } else {
        // Flush any pending low-priority batch first
        if (lowBatch.length > 0) {
          groups.push(lowBatch.join('\n'));
          lowBatch = [];
        }
        groups.push(item.text);
      }
    }
    if (lowBatch.length > 0) {
      groups.push(lowBatch.join('\n'));
    }

    for (let i = 0; i < groups.length; i++) {
      await this.sendToTopic(sessionId, groups[i]);
    }
  }

  private cleanup(sessionId: string): void {
    this.topics.delete(sessionId);
    this.progress.delete(sessionId);
    this.lastSent.delete(sessionId);
    this.pendingTool.delete(sessionId);
    this.pendingReads.delete(sessionId);
    const ft = this.flushTimers.get(sessionId);
    if (ft) { clearTimeout(ft); this.flushTimers.delete(sessionId); }
    const rt = this.readTimer.get(sessionId);
    if (rt) { clearTimeout(rt); this.readTimer.delete(sessionId); }
  }

  // ── Bidirectional polling ─────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const updates = (await tgApi(this.config.botToken, 'getUpdates', {
          offset: this.pollOffset,
          timeout: 10,
          allowed_updates: ['message'],
        })) as Array<{ update_id: number; message?: unknown }>;

        if (Array.isArray(updates)) {
          for (const update of updates) {
            this.pollOffset = update.update_id + 1;
            await this.handleUpdate(update);
          }
        }
      } catch (e) {
        console.error('Telegram poll error:', e);
        await sleep(5000);
      }
    }
  }

  private async handleUpdate(update: { message?: unknown }): Promise<void> {
    const msg = update.message as {
      text?: string;
      message_thread_id?: number;
      from?: { is_bot?: boolean };
    } | undefined;

    if (!msg?.text || !msg.message_thread_id || msg.from?.is_bot) return;

    for (const [sessionId, topic] of this.topics) {
      if (topic.topicId === msg.message_thread_id) {
        const text = msg.text.trim().toLowerCase();
        const raw = msg.text.trim();

        if (text === 'approve' || text === 'y' || text === 'yes') {
          await this.onInbound?.({ sessionId, action: 'approve' });
        } else if (text === 'reject' || text === 'n' || text === 'no') {
          await this.onInbound?.({ sessionId, action: 'reject' });
        } else if (text === 'escape' || text === 'esc') {
          await this.onInbound?.({ sessionId, action: 'escape' });
        } else if (text === 'kill' || text === 'stop') {
          await this.onInbound?.({ sessionId, action: 'kill' });
        } else if (raw.startsWith('/')) {
          await this.onInbound?.({ sessionId, action: 'command', text: raw });
        } else {
          await this.onInbound?.({ sessionId, action: 'message', text: raw });
        }
        break;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}