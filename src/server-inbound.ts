/**
 * server-inbound.ts — Inbound command handler extracted from server.ts (Issue #4227).
 *
 * Exports:
 *   - `handleInbound(cmd, ctx)`: handles inbound commands from notification channels
 *     (Telegram approve/reject/escape/kill/session_approve/session_reject/message/command)
 *     and dispatches them to the appropriate SessionManager methods.
 *
 * Extraction acceptance criteria (per Ema's spec):
 *   - No behavior change
 *   - No edits in extracted files (src/routes/*.ts) beyond imports
 */
// Imports specific to handleInbound (controller logic for inbound commands)
import { type InboundCommand } from './channels/index.js';
import type { AppContext } from './app-context.js';
import { shutdownAcpRuntime, cleanupTerminatedSessionState } from './session-cleanup.js';
import { logger } from './logger.js';
import { channels } from './server-channels.js';
import { makePayload as makePayloadFromCtx } from './routes/context.js';


async function handleInbound(cmd: InboundCommand, ctx: AppContext): Promise<void> {
  try {
    switch (cmd.action) {
      case 'approve':
        await ctx.sessions.approve(cmd.sessionId);
        break;
      case 'reject':
        await ctx.sessions.reject(cmd.sessionId);
        break;
      case 'escape':
        await ctx.sessions.escape(cmd.sessionId);
        break;
      case 'kill':
        // #842: killSession first, then notify — avoids race where channels
        // reference a session that is still being destroyed.
        // #4294: Shut down ACP runtime before killing session metadata.
        await shutdownAcpRuntime(cmd.sessionId, ctx);
        await ctx.sessions.killSession(cmd.sessionId);
        channels.sessionEnded(makePayloadFromCtx(ctx.sessions, 'session.ended', cmd.sessionId, 'killed'));
        cleanupTerminatedSessionState(cmd.sessionId, { monitor: ctx.monitor, metrics: ctx.metrics, toolRegistry: ctx.toolRegistry });
        break;
      case 'session_approve': {
        // Issue #4116: Debounce — skip if this session was already processed recently.
        if (recentApprovalActions.has(cmd.sessionId)) break;
        recentApprovalActions.add(cmd.sessionId);
        setTimeout(() => recentApprovalActions.delete(cmd.sessionId), 2000);
        // Issue #4117: Include actor info (Telegram user) in approvedBy.
        const approveActor = cmd.actor?.type === 'telegram'
          ? `telegram:${cmd.actor.userId} (${cmd.actor.firstName})`
          : 'telegram';
        // Issue #4092: Wrap in try/catch — stale Telegram callbacks (e.g. user taps
        // Approve after session was already approved via API) should not crash callback processing.
        try {
          await ctx.sessions.approveSession(cmd.sessionId, approveActor);
          channels.statusChange({
            event: 'session.approved',
            timestamp: new Date().toISOString(),
            session: { id: cmd.sessionId, name: '', workDir: '', runnerName: undefined },
            detail: `Session approved by ${approveActor}`,
          });
        } catch (e) {
          logger.error({ component: 'server', operation: 'session_approve', sessionId: cmd.sessionId, attributes: { error: String(e) } });
        }
        break;
      }
      case 'session_reject': {
        // Issue #4116: Debounce — skip if this session was already processed recently.
        if (recentApprovalActions.has(cmd.sessionId)) break;
        recentApprovalActions.add(cmd.sessionId);
        setTimeout(() => recentApprovalActions.delete(cmd.sessionId), 2000);
        // Issue #4117: Include actor info in rejection log.
        const rejectActor = cmd.actor?.type === 'telegram'
          ? `telegram:${cmd.actor.userId} (${cmd.actor.firstName})`
          : 'telegram';
        try {
          await ctx.sessions.rejectSession(cmd.sessionId);
          channels.statusChange({
            event: 'session.rejected',
            timestamp: new Date().toISOString(),
            session: { id: cmd.sessionId, name: '', workDir: '', runnerName: undefined },
            detail: `Session rejected by ${rejectActor}`,
          });
        } catch (e) {
          logger.error({ component: 'server', operation: 'session_reject', sessionId: cmd.sessionId, attributes: { error: String(e) } });
        }
        break;
      }
      case 'message':
      case 'command':
        if (cmd.text) await ctx.sessions.sendMessage(cmd.sessionId, cmd.text);
        break;
    }
  } catch (e) {
    logger.error({
      component: 'server',
      operation: 'handle_inbound',
      errorCode: 'INBOUND_COMMAND_ERROR',
      attributes: {
        action: cmd.action,
        error: e instanceof Error ? e.message : String(e),
      },
    });
  }
}

// Re-export channels for use by server-bootstrap.ts
export { channels };

// Issue #4116: Debounce Set for session approval callbacks (prevents duplicate
// notifications from rapid Telegram clicks). Moved here from server-bootstrap.ts
// since it's only used by handleInbound.
const recentApprovalActions = new Set<string>();
export { recentApprovalActions };

// Export the handleInbound function
export { handleInbound };
