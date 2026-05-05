/**
 * types/acp-chat.ts — Types for the ACP chat view.
 *
 * Matches the normalized event model from epic §7.3:
 *   - text delta → message.delta
 *   - thinking → thinking.delta
 *   - tool call → tool.started / tool.completed
 *   - usage → usage.updated
 *   - turn end → turn.completed
 */

/** Chat message role. */
export type AcpChatRole = 'user' | 'assistant' | 'system';

/** A single chat message in the conversation. */
export interface AcpChatMessage {
  id: string;
  role: AcpChatRole;
  /** Message text content. May be streamed (partial). */
  content: string;
  /** Whether this message is still being streamed. */
  isStreaming?: boolean;
  /** Thinking/reasoning blocks (shown collapsed by default). */
  thinking?: AcpThinkingBlock[];
  /** Tool calls made in this message. */
  toolCalls?: AcpToolCall[];
  /** Token usage for this message. */
  usage?: AcpTokenUsage;
  /** Timestamp (ISO string). */
  timestamp: string;
}

/** A thinking/reasoning block within a message. */
export interface AcpThinkingBlock {
  id: string;
  content: string;
  /** Whether this block is still being streamed. */
  isStreaming?: boolean;
}

/** A tool call within a chat message. */
export interface AcpToolCall {
  id: string;
  toolName: string;
  input?: Record<string, unknown>;
  /** Tool result, if completed. */
  result?: AcpToolResult;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}

/** Tool call result. */
export interface AcpToolResult {
  output?: string;
  error?: string;
  /** File diffs produced by the tool (for edit/write tools). */
  diffs?: AcpFileDiff[];
  durationMs?: number;
}

/** A file diff from a tool result. */
export interface AcpFileDiff {
  filePath: string;
  /** Unified diff content. */
  diff: string;
  additions?: number;
  deletions?: number;
}

/** Token usage breakdown. */
export interface AcpTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
}

/** Cumulative token usage for the session. */
export interface AcpSessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number;
}

/** Chat view configuration. */
export interface AcpChatViewConfig {
  /** Whether to show thinking blocks by default. */
  showThinking?: boolean;
  /** Whether to show token usage per message. */
  showPerMessageUsage?: boolean;
  /** Whether to auto-scroll to bottom on new messages. */
  autoScroll?: boolean;
}
