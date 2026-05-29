/**
 * services/cc-session-registry.ts — Maps Claude Code session IDs to Aegis session IDs.
 *
 * CC v2.1.154 passes CLAUDE_CODE_SESSION_ID to MCP server subprocesses.
 * This registry correlates CC's native session ID with the Aegis session
 * that the MCP tools operate on, enabling cross-session context bridging,
 * dashboard enrichment, and per-session metering.
 *
 * Issue #4455.
 */

/** Bidirectional lookup between CC and Aegis session IDs. */
export class CcSessionRegistry {
  /** CC session ID → Aegis session ID */
  private readonly ccToAegis = new Map<string, string>();
  /** Aegis session ID → CC session ID */
  private readonly aegisToCc = new Map<string, string>();

  /**
   * Record that a Claude Code session operated on an Aegis session.
   * Overwrites any previous mapping for either side.
   */
  record(ccSessionId: string, aegisSessionId: string): void {
    // Clean up old reverse mapping if Aegis session was previously mapped to a different CC session
    const oldCc = this.aegisToCc.get(aegisSessionId);
    if (oldCc && oldCc !== ccSessionId) {
      this.ccToAegis.delete(oldCc);
    }
    // Clean up old forward mapping if CC session was previously mapped to a different Aegis session
    const oldAegis = this.ccToAegis.get(ccSessionId);
    if (oldAegis && oldAegis !== aegisSessionId) {
      this.aegisToCc.delete(oldAegis);
    }

    this.ccToAegis.set(ccSessionId, aegisSessionId);
    this.aegisToCc.set(aegisSessionId, ccSessionId);
  }

  /** Look up the Aegis session ID for a CC session. */
  getAegisSessionId(ccSessionId: string): string | undefined {
    return this.ccToAegis.get(ccSessionId);
  }

  /** Look up the CC session ID for an Aegis session. */
  getCcSessionId(aegisSessionId: string): string | undefined {
    return this.aegisToCc.get(aegisSessionId);
  }

  /** Remove all mappings involving an Aegis session ID. */
  removeByAegisSessionId(aegisSessionId: string): void {
    const cc = this.aegisToCc.get(aegisSessionId);
    if (cc) {
      this.ccToAegis.delete(cc);
      this.aegisToCc.delete(aegisSessionId);
    }
  }

  /** Get all known CC↔Aegis mappings. */
  entries(): ReadonlyArray<{ ccSessionId: string; aegisSessionId: string }> {
    return Array.from(this.ccToAegis.entries()).map(([ccSessionId, aegisSessionId]) => ({
      ccSessionId,
      aegisSessionId,
    }));
  }

  /** Number of active mappings. */
  get size(): number {
    return this.ccToAegis.size;
  }
}

/** Singleton registry instance. */
export const ccSessionRegistry = new CcSessionRegistry();

/**
 * Read CLAUDE_CODE_SESSION_ID from the environment.
 * Returns undefined if not set (older CC versions or non-CC callers).
 */
export function getCcSessionIdFromEnv(): string | undefined {
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (id && id.length > 0) return id;
  return undefined;
}
