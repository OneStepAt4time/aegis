/**
 * handshake.ts — Capability handshake schema and negotiation for Aegis/Claude Code.
 *
 * Issue #885: Defines a formal protocolVersion + capabilities negotiation so
 * that clients and Aegis can agree on supported feature set before using
 * advanced integration paths. Prevents version-drift breakage.
 */

/** Current protocol version advertised by this Aegis build. */
export const AEGIS_PROTOCOL_VERSION = '1';

/** Minimum protocol version this Aegis build still accepts. */
export const AEGIS_MIN_PROTOCOL_VERSION = '1';

/**
 * All capabilities Aegis supports in this build.
 * Capabilities are additive; absence means the feature is unavailable/disabled.
 */
export const AEGIS_CAPABILITIES = [
  'session.create',
  'session.resume',
  'session.approve',
  'session.transcript',
  'session.transcript.cursor',   // Issue #883: cursor-based replay
  'session.events.sse',
  'session.screenshot',
  'hooks.pre_tool_use',
  'hooks.post_tool_use',
  'hooks.notification',
  'hooks.stop',
  'swarm',
  'metrics',
] as const;

export type AegisCapability = (typeof AEGIS_CAPABILITIES)[number];

/** Request body for POST /v1/handshake */
export interface HandshakeRequest {
  protocolVersion: string;
  clientCapabilities?: string[];
  clientVersion?: string;
}

/** Response shape for POST /v1/handshake */
export interface HandshakeResponse {
  protocolVersion: string;
  serverCapabilities: AegisCapability[];
  negotiatedCapabilities: AegisCapability[];
  warnings: string[];
  compatible: boolean;
}

/**
 * Negotiate capabilities between a client request and this Aegis build.
 *
 * Rules:
 * - If client protocolVersion < AEGIS_MIN_PROTOCOL_VERSION → not compatible, add warning, return empty negotiatedCapabilities
 * - If client protocolVersion > AEGIS_PROTOCOL_VERSION → compatible but add forward-compat warning
 * - negotiatedCapabilities = intersection of server caps and clientCapabilities (or all server caps if client sends none)
 */
export function negotiate(req: HandshakeRequest): HandshakeResponse {
  const warnings: string[] = [];
  const serverCapabilities = [...AEGIS_CAPABILITIES];

  // Parse major version numbers for comparison
  const clientMajor = parseInt(req.protocolVersion, 10);
  const serverMajor = parseInt(AEGIS_PROTOCOL_VERSION, 10);
  const minMajor = parseInt(AEGIS_MIN_PROTOCOL_VERSION, 10);

  if (isNaN(clientMajor)) {
    return {
      protocolVersion: AEGIS_PROTOCOL_VERSION,
      serverCapabilities,
      negotiatedCapabilities: [],
      warnings: [`Unrecognized protocolVersion format: "${req.protocolVersion}". Expected integer string.`],
      compatible: false,
    };
  }

  if (clientMajor < minMajor) {
    return {
      protocolVersion: AEGIS_PROTOCOL_VERSION,
      serverCapabilities,
      negotiatedCapabilities: [],
      warnings: [
        `Client protocolVersion ${req.protocolVersion} is below minimum supported version ${AEGIS_MIN_PROTOCOL_VERSION}. Upgrade required.`,
      ],
      compatible: false,
    };
  }

  if (clientMajor > serverMajor) {
    warnings.push(
      `Client protocolVersion ${req.protocolVersion} is newer than server version ${AEGIS_PROTOCOL_VERSION}. Some client features may be unavailable.`,
    );
  }

  // Intersect: client declares what it supports; server only enables what it also supports
  let negotiatedCapabilities: AegisCapability[];
  if (!req.clientCapabilities || req.clientCapabilities.length === 0) {
    // Client omitted capabilities → assume full server capability set
    negotiatedCapabilities = serverCapabilities;
  } else {
    const serverSet = new Set<string>(serverCapabilities);
    const unknown = req.clientCapabilities.filter(c => !serverSet.has(c));
    if (unknown.length > 0) {
      warnings.push(`Unknown client capabilities ignored: ${unknown.join(', ')}`);
    }
    negotiatedCapabilities = req.clientCapabilities.filter(
      (c): c is AegisCapability => serverSet.has(c),
    );
  }

  return {
    protocolVersion: AEGIS_PROTOCOL_VERSION,
    serverCapabilities,
    negotiatedCapabilities,
    warnings,
    compatible: true,
  };
}
