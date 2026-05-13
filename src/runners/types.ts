/**
 * runners/types.ts — Agent Runner interface and common types.
 *
 * Issue #3263: Pluggable agent backend abstraction.
 * Defines the contract for agent lifecycle operations (start, send, read, kill)
 * that any runner (Claude Code, Codex, Gemini CLI, etc.) must implement.
 */

/** Unique identifier for a running agent process. */
export type ProcessHandle = string;

/** A chunk of output from a running agent. */
export interface OutputChunk {
  /** Text content. */
  text: string;
  /** Source stream. */
  source: 'stdout' | 'stderr';
  /** ISO timestamp when this chunk was emitted. */
  timestamp: string;
}

/** Configuration for starting a new agent process. */
export interface RunnerStartConfig {
  /** Working directory for the agent process. */
  cwd: string;
  /** Optional system prompt to inject. */
  systemPrompt?: string;
  /** Optional MCP servers to expose to the agent. */
  mcpServers?: Record<string, unknown>;
  /** Optional environment variables. */
  env?: Record<string, string>;
  /** Optional display name for the session. */
  displayName?: string;
}

/** Result of a successful start operation. */
export interface RunnerStartResult {
  /** The process handle for subsequent operations. */
  handle: ProcessHandle;
  /** Capabilities advertised by the agent (agent-specific shape). */
  capabilities?: Record<string, unknown>;
  /** Agent-reported metadata (name, version, etc.). */
  agentInfo?: Record<string, unknown>;
}

/** Result of a send/prompt operation. */
export interface RunnerSendResult {
  /** Whether the input was delivered successfully. */
  delivered: boolean;
  /** Number of delivery attempts made. */
  attempts: number;
  /** Error message if delivery failed. */
  error?: string;
}

/** Options for killing an agent process. */
export interface RunnerKillOptions {
  /** If true, force-kill (SIGKILL) instead of graceful shutdown. */
  force?: boolean;
  /** Timeout in ms to wait for graceful shutdown before force-killing. */
  timeoutMs?: number;
}

/** Result of a kill operation. */
export interface RunnerKillResult {
  /** Exit code or signal. */
  exitCode: number | null;
  /** Whether the shutdown was clean (expected). */
  clean: boolean;
}

/**
 * AgentRunner — the pluggable agent backend interface.
 *
 * Each runner encapsulates one agent type (Claude Code, Codex, Gemini CLI, etc.)
 * and manages its lifecycle through a standardized contract.
 *
 * Implementations MUST be stateless with respect to handles — all state
 * should be keyed by ProcessHandle, allowing a single runner instance
 * to manage multiple concurrent sessions.
 */
export interface AgentRunner {
  /** Human-readable runner name (e.g., 'claude-code', 'codex', 'gemini-cli'). */
  readonly name: string;

  /**
   * Start a new agent process.
   *
   * @param sessionId - The Aegis session ID this process belongs to.
   * @param config - Start configuration (cwd, prompt, env, etc.).
   * @returns A handle and optional capabilities/metadata.
   */
  start(sessionId: string, config: RunnerStartConfig): Promise<RunnerStartResult>;

  /**
   * Send input (prompt) to a running agent.
   *
   * @param handle - The process handle from start().
   * @param input - The text input to send.
   * @returns Delivery result.
   */
  sendInput(handle: ProcessHandle, input: string): Promise<RunnerSendResult>;

  /**
   * Read output from a running agent.
   *
   * Returns an async iterable that yields output chunks as they arrive.
   * Callers should consume this in a loop and break when done.
   *
   * @param handle - The process handle from start().
   */
  readOutput(handle: ProcessHandle): AsyncIterable<OutputChunk>;

  /**
   * Kill a running agent process.
   *
   * Attempts graceful shutdown first, then force-kills after timeout.
   *
   * @param handle - The process handle from start().
   * @param options - Kill options.
   * @returns Kill result with exit info.
   */
  kill(handle: ProcessHandle, options?: RunnerKillOptions): Promise<RunnerKillResult>;

  /**
   * Check if an agent process is still alive.
   *
   * @param handle - The process handle from start().
   */
  isAlive(handle: ProcessHandle): boolean;

  /**
   * Get the process handle for an Aegis session, if one exists.
   *
   * @param sessionId - The Aegis session ID.
   * @returns The process handle or undefined.
   */
  getHandle(sessionId: string): ProcessHandle | undefined;
}

/**
 * RunnerRegistry — resolves runner names to AgentRunner instances.
 *
 * Allows the session manager to look up the correct runner for a given
 * session based on configuration or session-level overrides.
 */
export interface RunnerRegistry {
  /**
   * Register a runner instance.
   *
   * @param runner - The runner to register.
   */
  register(runner: AgentRunner): void;

  /**
   * Get a runner by name.
   *
   * @param name - Runner name (e.g., 'claude-code').
   * @returns The runner or undefined.
   */
  get(name: string): AgentRunner | undefined;

  /** List all registered runner names. */
  listNames(): string[];

  /** Get the default runner. */
  getDefault(): AgentRunner;
}
