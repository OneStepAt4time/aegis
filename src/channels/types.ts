/**
 * channels/types.ts — Notification channel interface.
 *
 * Every notification channel (Telegram, Discord, webhook, Slack, etc.)
 * implements this interface. The bridge doesn't know or care which
 * channels are active — it fires events, channels decide what to do.
 */

/** Events a channel can subscribe to. */
export type SessionEvent =
  | 'session.created'
  | 'session.ended'
  | 'message.user'
  | 'message.assistant'
  | 'message.thinking'
  | 'message.tool_use'
  | 'message.tool_result'
  | 'status.idle'
  | 'status.working'
  | 'status.permission'
  | 'status.question'
  | 'status.plan'
  | 'status.stall'
  | 'status.dead'
  | 'status.stopped'
  | 'status.error'
  | 'status.rate_limited'
  | 'status.permission_timeout'
  | 'swarm.teammate_spawned'
  | 'swarm.teammate_finished';

/** Payload for all session events. */
export interface SessionEventPayload {
  event: SessionEvent;
  timestamp: string;
  session: {
    id: string;
    name: string;
    workDir: string;
  };
  detail: string;
  /** Contextual data — depends on event type. */
  meta?: Record<string, unknown>;
}

/** Inbound command from a channel (user replied in Telegram, webhook callback, etc.) */
export interface InboundCommand {
  sessionId: string;
  action: 'approve' | 'reject' | 'escape' | 'kill' | 'message' | 'command';
  text?: string;
}

/** Callback for inbound commands. */
export type InboundHandler = (cmd: InboundCommand) => Promise<void>;

/**
 * A notification channel.
 *
 * Channels are initialized once and receive events for the lifetime
 * of the bridge. They can optionally accept inbound commands
 * (bidirectional channels like Telegram).
 */
export interface Channel {
  /** Human-readable channel name (for logging). */
  readonly name: string;

  /** Initialize the channel. Called once at startup. */
  init?(onInbound: InboundHandler): Promise<void>;

  /** Tear down the channel. Called on shutdown. */
  destroy?(): Promise<void>;

  /** Called when a new session is created. */
  onSessionCreated?(payload: SessionEventPayload): Promise<void>;

  /** Called when a session ends. */
  onSessionEnded?(payload: SessionEventPayload): Promise<void>;

  /** Called when a message is sent to/from CC. */
  onMessage?(payload: SessionEventPayload): Promise<void>;

  /** Called when session status changes (idle, working, permission, question, plan). */
  onStatusChange?(payload: SessionEventPayload): Promise<void>;

  /**
   * Optional: filter which events this channel cares about.
   * Return true to receive the event, false to skip.
   * If not implemented, receives all events.
   */
  filter?(event: SessionEvent): boolean;
}
