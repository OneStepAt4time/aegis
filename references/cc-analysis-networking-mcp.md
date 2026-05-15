# Claude Code Networking, MCP Architecture Analysis

## Executive Summary

This document analyzes the networking, remote execution, MCP (Model Context Protocol), and command system architecture of Claude Code's leaked codebase. The analysis focuses on understanding how Claude Code implements remote sessions, MCP server/client communication, bridge architecture for remote control, and the command registry system.

---

## Table of Contents

1. [MCP Protocol Implementation](#mcp-protocol-implementation)
2. [Remote Session Management](#remote-session-management)
3. [Bridge System Architecture](#bridge-system-architecture)
4. [Server Implementation](#server-implementation)
5. [Upstream Proxy](#upstream-proxy)
6. [Command System](#command-system)
7. [Key Findings](#key-findings)

---

## 1. MCP Protocol Implementation

### Overview

Claude Code implements both MCP **server** and **client** functionality:

- **MCP Server**: Exposes Claude Code tools via the MCP protocol for external orchestrators
- **MCP Client**: Connects to external MCP servers to extend Claude Code's capabilities

### MCP Server Implementation (\`src/entrypoints/mcp.ts\`)

The MCP server implementation allows Claude Code to act as an MCP server, exposing its tools to external clients.

**Key Components:**

1. **Server Initialization**
   \`\`\`typescript
   const server = new Server(
     { name: 'claude/tengu', version: MACRO.VERSION },
     { capabilities: { tools: {} } }
   )
   \`\`\`

2. **Transport**: Uses \`StdioServerTransport\` for standard input/output communication

3. **Tool Registration**
   - Implements \`ListToolsRequestSchema\` to enumerate available tools
   - Converts internal tool definitions to MCP tool schema format
   - Transforms Zod schemas to JSON Schema for MCP compatibility

4. **Tool Execution**
   - Implements \`CallToolRequestSchema\` to handle tool invocations
   - Validates inputs using Zod schemas
   - Returns results as text content in MCP format
   - Handles errors gracefully with proper error typing

**Notable Features:**
- Supports output schemas with proper MCP type checking
- Integrates with Claude Code's permission system
- Uses size-limited LRU cache for file state management
- Supports debug and verbose modes


### MCP Client Implementation (\`src/services/mcp/client.ts\`)

The MCP client is the most complex component, managing connections to external MCP servers.

**Transport Types Supported:**

1. **Stdio Transport**: Local process communication via stdin/stdout
2. **SSE Transport**: Server-Sent Events over HTTP
3. **HTTP Transport**: Streamable HTTP transport
4. **WebSocket Transport**: Custom WebSocket implementation for real-time communication
5. **Claude.ai Proxy**: OAuth-authenticated proxy connections

**Key Features:**

1. **Connection Management**
   - Automatic reconnection with exponential backoff
   - Connection timeout handling (default 30s)
   - Batch connection support for performance

2. **Authentication**
   - OAuth 2.0 support with automatic token refresh
   - 15-minute auth cache to avoid repeated prompts
   - Secure storage for client secrets

3. **Tool Call Handling**
   - Configurable timeout (default ~27.8 hours via \`MCP_TOOL_TIMEOUT\` env var)
   - Output size validation and truncation
   - Image processing and downsampling
   - Binary content persistence

4. **Error Handling**
   - Session expiration detection
   - Authentication error classification
   - Graceful degradation on failures

**Connection Flow:**
\`\`\`
1. Load MCP server configs from .mcp.json / settings
2. Validate and normalize server names
3. Create appropriate transport (stdio/sse/http/ws)
4. Establish connection with timeout
5. List available tools and resources
6. Handle OAuth if required
7. Expose tools to Claude Code's tool registry
\`\`\`

**MCP Tool Wrapping:**
External MCP tools are wrapped as \`MCPTool\` instances that integrate with Claude Code's permission system. The wrapper:
- Validates inputs using Zod schemas
- Handles tool execution with proper error handling
- Supports progress reporting
- Implements content truncation for large outputs

---

## 2. Remote Session Management

### Overview

Claude Code implements a sophisticated remote session management system for executing Claude sessions on remote infrastructure (CCR - Claude Code Remote).

### RemoteSessionManager (\`src/remote/RemoteSessionManager.ts\`)

**Purpose**: Manages remote CCR sessions from the CLI side.

**Key Components:**

1. **WebSocket Subscription**: Subscribes to session events via \`SessionsWebSocket\`
2. **HTTP Message Sending**: Sends user messages via HTTP POST
3. **Permission Handling**: Manages permission requests from remote sessions
4. **Connection State**: Tracks connection status and handles reconnection

**Architecture:**
\`\`\`
RemoteSessionManager
├── SessionsWebSocket (receives events)
├── HTTP Client (sends messages)
├── Permission Queue (manages permission requests)
└── State Tracking (connection status)
\`\`\`

**Message Types Handled:**
- \`SDKMessage\`: Regular Claude messages (assistant, user, system)
- \`SDKControlRequest\`: Permission requests from remote
- \`SDKControlResponse\`: Responses to control requests
- \`SDKControlCancelRequest\`: Cancellation notices

**Permission Flow:**
\`\`\`
1. Remote session requests permission
2. RemoteSessionManager queues request
3. CLI prompts user for decision
4. User responds (allow/deny)
5. RemoteSessionManager sends control_response
6. Remote session proceeds/denies tool use
\`\`\`


### SessionsWebSocket (\`src/remote/SessionsWebSocket.ts\`)

**Purpose**: WebSocket client for real-time session communication.

**Key Features:**

1. **Connection Management**
   - Automatic reconnection with exponential backoff (2s initial, 120s max)
   - Maximum 5 reconnection attempts
   - 3 additional retries for "session not found" (4001) errors
   - Ping/pong keepalive every 30s

2. **Authentication**
   - OAuth bearer token in headers
   - Per-connection token refresh

3. **Message Handling**
   - JSON parsing with validation
   - Type-safe message routing
   - Error recovery

4. **Runtime Support**
   - Bun native WebSocket
   - Node.js ws package fallback

**Close Codes:**
- \`4003\` (Unauthorized): Permanent close, no retry
- \`4001\` (Session Not Found): Retry with backoff
- Other codes: Retry if under limit

---

## 3. Bridge System Architecture

### Overview

The bridge system is Claude Code's distributed computing infrastructure, allowing CLI instances to run as workers that execute sessions remotely.

### Bridge Main (\`src/bridge/bridgeMain.ts\` - 3001 lines)

**Purpose**: Main orchestrator for bridge loop that manages remote session execution.

**Key Responsibilities:**

1. **Environment Registration**
   - Registers bridge environment with server
   - Provides machine metadata (name, directory, branch, repo URL)
   - Advertises session capacity
   - Supports environment reuse for session resumption

2. **Work Polling**
   - Long-poll for work items from server
   - Exponential backoff on connection failures
   - Sleep/wake detection for handling system suspend
   - Configurable poll intervals

3. **Session Spawning**
   - Spawns child Claude processes with session configuration
   - Manages isolated worktrees for per-session isolation
   - Handles both CCR v1 and v2 protocols

4. **Session Management**
   - Tracks active sessions with handles
   - Implements session timeouts (default 24 hours)
   - Monitors session activity (tool usage, text generation)
   - Updates status display in real-time

5. **Permission Handling**
   - Receives permission requests from remote sessions
   - Sends permission decisions back to sessions
   - Supports allow/deny with message

6. **Token Management**
   - Proactive OAuth token refresh (5 minutes before expiry)
   - Session ingress JWT refresh
   - Different strategies for v1 vs v2 sessions

7. **Cleanup & Shutdown**
   - Graceful session termination
   - Worktree cleanup
   - Server deregistration
   - Pending operation tracking


**Spawn Modes:**

1. **single-session**: One session in current directory, bridge exits when session ends
2. **worktree**: Persistent server, each session gets isolated git worktree
3. **same-dir**: Persistent server, all sessions share directory (potential conflicts)

**Multi-Session Support:**
- Controlled by GrowthBook feature flag \`tengu_ccr_bridge_multi_session\`
- Maximum concurrent sessions (default: 32)
- Capacity wake mechanism for immediate session acceptance

**Session Activity Tracking:**
\`\`\`
SessionHandle
├── activities: SessionActivity[] (ring buffer, last ~10)
├── currentActivity: most recent
├── done: Promise<SessionDoneStatus>
├── kill(): graceful termination
└── forceKill(): immediate termination
\`\`\`

### Bridge API Client (\`src/bridge/bridgeApi.ts\`)

**Purpose**: HTTP client for bridge server communication.

**Key Endpoints:**

1. **POST /v1/environments/bridge**: Register bridge environment
2. **GET /v1/environments/{id}/work**: Poll for work items
3. **POST /v1/environments/{id}/work/{workId}/ack**: Acknowledge work
4. **POST /v1/environments/{id}/work/{workId}/stop**: Stop work
5. **DELETE /v1/environments/{id}**: Deregister environment
6. **POST /v1/sessions/{id}/events**: Send permission responses
7. **POST /v1/sessions/{id}/archive**: Archive session
8. **POST /v1/environments/{id}/reconnect**: Reconnect session

**Authentication:**
- OAuth bearer token in Authorization header
- X-Trusted-Device-Token header for elevated sessions
- Automatic 401 retry with token refresh

### Bridge Types (\`src/bridge/types.ts\`)

**Key Types:**

- \`BridgeConfig\`: Bridge configuration
- \`SessionHandle\`: Active session handle
- \`WorkResponse\`: Work item from server
- \`WorkSecret\`: Session credentials and configuration
- \`BridgeApiClient\`: API client interface

**Work Secret Structure:**
\`\`\`typescript
{
  version: number
  session_ingress_token: string  // JWT for session API
  api_base_url: string
  sources: Array<{type, git_info, token}>
  auth: Array<{type, token}>
  claude_code_args?: Record<string, string>
  mcp_config?: unknown
  environment_variables?: Record<string, string>
  use_code_sessions?: boolean  // CCR v2 flag
}
\`\`\`

---

## 4. Server Implementation

### Direct Connect Manager (\`src/server/directConnectManager.ts\`)

**Purpose**: Manages direct connections to bridge sessions without full bridge infrastructure.

**Key Features:**

1. **WebSocket Connection**
   - Direct WebSocket connection to session endpoint
   - Bearer token authentication
   - Message parsing and routing

2. **Message Types**
   - SDK messages (assistant, user, system)
   - Control requests (permissions)
   - Keep-alive messages

3. **Permission Handling**
   - Receives permission requests
   - Sends permission responses
   - Supports interrupt signals

**Use Cases:**
- Direct session connection without bridge polling
- Lightweight session attachment
- Development and testing scenarios

### Server Web (\`src/server/web/\`)

**Purpose**: Web interface for bridge server.

**Components:**
- HTTP server for API endpoints
- WebSocket upgrade support
- Static file serving


---

## 5. Upstream Proxy

### Overview

The upstream proxy system provides MITM (Man-in-the-Middle) proxy capabilities for network traffic inspection and modification in CCR containers.

### Upstream Proxy (\`src/upstreamproxy/upstreamproxy.ts\`)

**Purpose**: Container-side proxy configuration and management.

**Key Features:**

1. **CA Certificate Management**
   - Downloads proxy CA certificate
   - Concatenates with system CA bundle
   - Sets SSL_CERT_FILE environment variable

2. **Proxy Configuration**
   - Reads session token from \`/run/ccr/session_token\`
   - Sets HTTPS_PROXY environment variable
   - Configures NO_PROXY for local/internal hosts

3. **Security**
   - Calls \`prctl(PR_SET_DUMPABLE, 0)\` to prevent ptrace
   - Token file deletion after relay startup
   - Heap-only token storage

4. **Environment Variables**
   - HTTPS_PROXY: http://127.0.0.1:{port}
   - SSL_CERT_FILE: Path to combined CA bundle
   - NO_PROXY: List of excluded hosts

**NO_PROXY List:**
\`\`\`
localhost, 127.0.0.1, ::1,
169.254.0.0/16, 10.0.0.0/8,
172.16.0.0/12, 192.168.0.0/16
*.anthropic.com, .anthropic.com
\`\`\`

### Relay (\`src/upstreamproxy/relay.ts\`)

**Purpose**: Local CONNECT→WebSocket relay for upstream proxy.

**Protocol:**

1. **Client Connection**
   - Client sends HTTP CONNECT request
   - Relay parses CONNECT line to extract target host:port
   - Establishes WebSocket connection to upstream proxy

2. **Tunneling**
   - WebSocket binary frames carry tunnelled traffic
   - Custom chunking protocol with varint length encoding
   - Bidirectional forwarding (client ↔ WS ↔ upstream)

3. **Keep-Alive**
   - Ping/pong every 30 seconds
   - Zero-length chunks for keep-alive

**Chunk Format:**
\`\`\`
[1 byte: wire_type] [varint: length] [bytes: payload]
\`\`\`

**Wire Types:**
- \`0x01\`: CONNECT
- \`0x02\`: DATA

**Error Handling:**
- Returns HTTP 502 on WebSocket errors (before tunnel establishment)
- Closes connection on errors (after tunnel establishment)
- Logs all errors for debugging


---

## 6. Command System

### Command Registry (\`src/commands.ts\`)

**Purpose**: Central registry for all Claude Code commands.

**Architecture:**

1. **Command Types**
   - \`local\`: Executes TypeScript/JavaScript code
   - \`prompt\`: Generates prompts for Claude
   - \`jsx\`: React components for interactive UI

2. **Command Structure**
   \`\`\`typescript
   type Command = LocalCommand | PromptCommand | JSXCommand
   \`\`\`

3. **Registration**
   - Commands imported at module level
   - Memoized getter function for lazy evaluation
   - Feature-flagged commands conditionally loaded

4. **Internal vs External**
   - \`INTERNAL_ONLY_COMMANDS\`: Anthropic-internal commands (filtered from external builds)
   - External commands: User-facing commands included in public releases

**Command Categories:**

1. **Session Management**: \`resume\`, \`compact\`, \`clear\`, \`rename\`, \`session\`
2. **Mcp**: \`mcp\` (add, remove, list, get, serve, etc.)
3. **Configuration**: \`config\`, \`init\`, \`model\`, \`permissions\`, \`hooks\`
4. **Git/Development**: \`commit\`, \`branch\`, \`review\`, \`pr_comments\`
5. **Remote**: \`teleport\`, \`mobile\`, \`desktop\`
6. **Agents**: \`agents\`, \`plugin\`, \`skills\`
7. **Utilities**: \`doctor\`, \`cost\`, \`status\`, \`version\`, \`help\`

### MCP Commands (\`src/cli/handlers/mcp.tsx\`)

**Purpose**: CLI handlers for MCP subcommands.

**Subcommands:**

1. **mcp serve**: Start MCP server
   - Validates working directory
   - Initializes Claude Code environment
   - Starts MCP server with stdio transport

2. **mcp add**: Add MCP server configuration
   - Interactive configuration
   - Multiple transport types (stdio, sse, http)
   - OAuth configuration support

3. **mcp add-json**: Add MCP server from JSON
   - Direct JSON configuration
   - Scope selection (local/project/user)
   - Client secret support

4. **mcp remove**: Remove MCP server
   - Scope-aware removal
   - Secure storage cleanup
   - Configuration file updates

5. **mcp list**: List configured MCP servers
   - Concurrent health checks
   - Connection status display
   - Transport type information

6. **mcp get**: Get MCP server details
   - Configuration display
   - Health status check
   - Scope information

7. **mcp add-from-claude-desktop**: Import from Claude Desktop
   - Platform-specific config reading
   - Interactive import dialog
   - Scope selection

8. **mcp reset-project-choices**: Reset project MCP server approvals
   - Clears approval cache
   - Resets enabled/disabled lists


---

## 7. Key Findings

### Architecture Patterns

1. **Dual MCP Role**: Claude Code acts as both MCP server and client, enabling extensibility in both directions

2. **Multi-Transport Support**: MCP client supports 5 transport types (stdio, sse, http, ws, claudeai-proxy)

3. **Remote Execution**: Bridge system enables distributed session execution with sophisticated work distribution

4. **Permission Delegation**: Remote sessions can request permissions from local CLI, maintaining user control

5. **Session Isolation**: Git worktrees provide isolated development environments for concurrent sessions

6. **Resilience**: Extensive retry logic, exponential backoff, and graceful degradation throughout

### Security Features

1. **Token Management**
   - OAuth tokens with automatic refresh
   - JWT-based session authentication
   - Session ingress tokens for API access

2. **Heap-Only Secrets**
   - Sensitive tokens deleted from filesystem after loading
   - \`prctl(PR_SET_DUMPABLE, 0)\` prevents memory inspection
   - Tokens never written to disk in plain text

3. **Trusted Devices**
   - Elevated permissions for trusted device connections
   - X-Trusted-Device-Token header for enhanced access

4. **CA Bundle Management**
   - Secure proxy certificate handling
   - System CA bundle concatenation
   - Environment variable configuration

5. **Ptrace Protection**
   - \`prctl(PR_SET_DUMPABLE, 0)\` on Linux prevents ptrace
   - Same-UID process memory inspection blocked

### Performance Optimizations

1. **Batch Connections**: Concurrent MCP server connections (configurable batch size)

2. **LRU Caches**: Size-limited caches for file state and auth status

3. **Connection Reuse**: Environment reuse for session resumption

4. **Lazy Loading**: Commands and heavy modules loaded on demand

5. **Ring Buffers**: Fixed-size activity and stderr tracking

6. **Keep-Alive**: WebSocket ping/pong every 30 seconds

7. **Capacity Wake**: Immediate session acceptance when capacity available

### Integration Points

1. **Bridge ↔ CLI**
   - WebSocket for real-time communication
   - HTTP for message delivery

2. **MCP ↔ Tools**
   - MCP tools wrapped as Claude Code tools
   - Permission system integration

3. **Remote ↔ Local**
   - Permission requests flow from remote to local CLI
   - User decisions propagated back to remote

4. **Server ↔ Client**
   - Bridge server distributes work
   - Clients poll and execute

5. **Proxy ↔ Container**
   - MITM proxy for traffic inspection
   - WebSocket tunneling for upstream connectivity

### Configuration Hierarchy

1. **Command-line args**: Highest priority
2. **Environment variables**: Runtime configuration
3. **Project config** (\`.claude/config.json\`): Project-specific settings
4. **Global config** (\`~/.claude/config.json\`): User-wide settings
5. **MCP config** (\`.mcp.json\`): MCP server definitions
6. **Defaults**: Lowest priority

### Error Handling Patterns

1. **Exponential Backoff**
   - Connection failures: 2s → 4s → 8s → ... → 120s max
   - General errors: 500ms → 1s → 2s → ... → 30s max
   - Give-up threshold: 10 minutes

2. **Graceful Degradation**
   - Auth failures: Re-authenticate and retry
   - Network errors: Retry with backoff
   - Fatal errors: Clean shutdown

3. **Session Recovery**
   - Session not found: Retry with backoff (transient during compaction)
   - Auth expired: Re-queue via bridge/reconnect
   - Connection lost: Automatic reconnection


---

## 8. Implementation Details

### Remote Permission Bridge (\`src/remote/remotePermissionBridge.ts\`)

**Purpose**: Bridges permission requests from remote sessions to local CLI.

**Flow:**
\`\`\`
1. Remote session needs permission
2. CCR server sends control_request
3. RemoteSessionManager receives and queues
4. CLI prompts user
5. User decides allow/deny
6. RemoteSessionManager sends control_response
7. Remote session executes/denies tool
\`\`\`

### SDK Message Adapter (\`src/remote/sdkMessageAdapter.ts\`)

**Purpose**: Adapts SDK messages for JSONL format.

**Key Functions:**
- Parse JSONL messages
- Validate message types
- Route to appropriate handlers
- Handle streaming messages

### Session Runner (\`src/bridge/sessionRunner.ts\`)

**Purpose**: Spawns and manages child Claude processes for bridge sessions.

**Key Features:**
1. **Process Spawning**
   - Isolated subprocess with session configuration
   - Environment variable injection
   - Command-line argument construction

2. **Worktree Management**
   - Creates isolated git worktree per session
   - Handles worktree cleanup
   - Supports branch creation

3. **Output Handling**
   - Captures stdout/stderr
   - Parses activity updates
   - Tracks session state

4. **Token Injection**
   - Session ingress token via environment
   - OAuth token via environment
   - API base URL configuration

### Buddy System (\`src/buddy/\`)

**Purpose**: Companion/sideassistant feature with visual character.

**Components:**

1. **Companion.ts**: Companion state management
2. **CompanionSprite.tsx**: Visual sprite rendering
3. **sprites.ts**: Sprite asset definitions
4. **useBuddyNotification.tsx**: Notification system
5. **prompt.ts**: Companion prompt integration

**Key Features:**
- Animated character with multiple states
- Notification system for important events
- Visual feedback for session status
- Customizable appearance

### MoreRight System (\`src/moreright/useMoreRight.tsx\`)

**Purpose**: Extended permissions system for elevated operations.

**Key Features:**
- Permission elevation for trusted contexts
- User confirmation for sensitive operations
- Audit logging for permission grants

### CLI Utilities (\`src/cli/\`)

**Key Components:**

1. **print.ts** (5596 lines): Output formatting and display
   - JSONL formatting for structured output
   - Message rendering
   - Tool result display

2. **structuredIO.ts**: Structured input/output handling
   - JSONL message parsing
   - Control message handling
   - Stream processing

3. **remoteIO.ts**: Remote session I/O handling
   - Permission request forwarding
   - Message routing

4. **update.ts**: CLI update mechanism
   - Version checking
   - Update installation

5. **transports/**: Transport implementations
   - stdio: Standard input/output
   - jsonl: JSON Lines format


---

## 9. Advanced Features

### Code Sessions (CCR v2)

**Purpose**: Enhanced remote session protocol with improved architecture.

**Key Differences from v1:**
1. **Transport**: SSE instead of WebSocket
2. **Authentication**: Session-specific JWTs
3. **Permission Flow**: Control channel separate from data channel
4. **Token Refresh**: Server-driven re-dispatch on expiry

**Implementation:**
- Enabled by \`use_code_sessions\` flag in WorkSecret
- Uses \`SdkControlClientTransport\` for permissions
- Session ingress JWT for API authentication
- Worker registration endpoint for capacity management

### Environment Variables

**Session Configuration:**
\`\`\`bash
CLAUDE_CODE_SESSION_INGRESS_TOKEN=<jwt>
CLAUDE_CODE_API_BASE_URL=<url>
CLAUDE_CODE_SOURCES=<json>
CLAUDE_CODE_AUTH=<json>
CLAUDE_CODE_ARGS=<json>
CLAUDE_CODE_MCP_CONFIG=<json>
CLAUDE_CODE_ENV_VARS=<json>
\`\`\`

**Proxy Configuration:**
\`\`\`bash
HTTPS_PROXY=http://127.0.0.1:{port}
SSL_CERT_FILE=<path>
NO_PROXY=<hosts>
\`\`\`

### Git Integration

**Worktree Management:**
- Isolated worktrees in \`~/.claude/worktrees/{sessionId}\`
- Branch naming: \`bridge-{sessionId}\`
- Automatic cleanup on session end
- Hook-based worktree detection

**Repository Support:**
- GitHub (token-based authentication)
- GitLab (token-based authentication)
- Bitbucket (token-based authentication)
- Generic git (SSH key authentication)

### MCP Server Configuration

**Configuration Sources:**
1. **.mcp.json**: Project-level MCP servers
2. **~/.claude/config.json**: User-level MCP servers
3. **Environment variables**: Runtime MCP servers

**Server Types:**
1. **stdio**: Local process communication
2. **sse**: Server-Sent Events over HTTP
3. **http**: Streamable HTTP transport
4. **claudeai-proxy**: Claude.ai authenticated proxy

**OAuth Configuration:**
\`\`\`json
{
  "mcpServers": {
    "server-name": {
      "type": "sse",
      "url": "https://example.com/mcp",
      "oauth": {
        "clientId": "...",
        "callbackPort": 8080
      }
    }
  }
}
\`\`\`


---

## 10. Testing & Debugging

### Debug Logging

**Environment Variables:**
- \`CLAUDE_DEBUG=1\`: Enable debug logging
- \`MCP_DEBUG=1\`: MCP-specific debug logging
- \`CLAUDE_MCP_SERVER_DEBUG=1\`: MCP server debug mode

**Debug Features:**
1. **Verbose Output**: Detailed operation logging
2. **Protocol Tracing**: MCP message inspection
3. **Connection State**: WebSocket state tracking
4. **Performance Metrics**: Timing information

### Health Checking

**MCP Server Health:**
\`\`\`typescript
async function checkMcpServerHealth(name: string, server: Config): Promise<string> {
  try {
    const result = await connectToServer(name, server)
    if (result.type === 'connected') return '✓ Connected'
    if (result.type === 'needs-auth') return '! Needs authentication'
    return '✗ Failed to connect'
  } catch {
    return '✗ Connection error'
  }
}
\`\`\`

**Bridge Health:**
- Environment registration status
- Session capacity monitoring
- Connection state tracking

### Error Recovery

**Common Issues:**

1. **Session Not Found (4001)**
   - Transient during compaction
   - Automatic retry with backoff
   - Maximum 3 retries

2. **Unauthorized (4003)**
   - Permanent failure
   - No automatic retry
   - Requires re-authentication

3. **Connection Timeout**
   - Exponential backoff retry
   - Maximum 5 attempts
   - 10-minute give-up threshold

4. **Auth Token Expired**
   - Automatic token refresh
   - Single retry on 401
   - Re-queue via bridge/reconnect for v2

---

## 11. Future Considerations

### Extensibility

1. **Custom Transports**: MCP transport interface allows new transport types
2. **Command Plugins**: Command registry supports external commands
3. **MCP Server Extensions**: MCP server can expose additional capabilities
4. **Bridge Extensions**: Bridge protocol supports new message types

### Scalability

1. **Horizontal Scaling**: Multiple bridge workers per environment
2. **Load Balancing**: Server-side work distribution
3. **Connection Pooling**: Reuse of MCP connections
4. **Caching**: Configurable cache sizes and TTLs

### Security Enhancements

1. **Certificate Pinning**: Verify MCP server certificates
2. **Audit Logging**: Comprehensive permission audit trail
3. **Rate Limiting**: Prevent abuse of MCP tools
4. **Sandbox Isolation**: Enhanced session isolation

---

## Conclusion

Claude Code's networking and MCP architecture demonstrates sophisticated distributed systems design with emphasis on:

- **Extensibility**: MCP protocol enables rich ecosystem integration
- **Resilience**: Comprehensive error handling and retry mechanisms
- **Security**: Defense-in-depth with multiple authentication and authorization layers
- **Performance**: Optimized for both local and remote execution scenarios
- **Developer Experience**: Intuitive CLI commands and interactive configuration

The bridge system enables remote execution while maintaining user control through permission delegation. The MCP implementation provides bidirectional extensibility, allowing Claude Code to both consume and provide tools. The command system offers a clean, extensible architecture for adding new functionality.

### Key Takeaways for Aegis Development

1. **MCP Protocol**: Aegis should implement MCP server to expose session management
2. **Bridge Architecture**: Consider similar worker model for distributed execution
3. **Permission System**: Implement permission delegation for remote sessions
4. **Token Management**: OAuth + JWT approach for authentication
5. **Error Handling**: Exponential backoff with configurable thresholds
6. **Multi-Transport**: Support multiple transport types for flexibility
7. **Configuration Hierarchy**: Clear precedence for configuration sources
8. **Debug Capabilities**: Comprehensive logging and health checking

This architecture positions Claude Code as both a powerful standalone tool and a platform for building sophisticated AI-assisted development workflows.

---

## References

### Source Files Analyzed

1. **MCP Implementation**
   - \`src/entrypoints/mcp.ts\`: MCP server implementation
   - \`src/services/mcp/client.ts\`: MCP client implementation (3349 lines)
   - \`src/cli/handlers/mcp.tsx\`: MCP CLI handlers (561 lines)
   - \`src/commands/mcp/mcp.tsx\`: MCP command definition

2. **Remote Session Management**
   - \`src/remote/RemoteSessionManager.ts\`: Remote session manager
   - \`src/remote/SessionsWebSocket.ts\`: WebSocket client
   - \`src/remote/sdkMessageAdapter.ts\`: SDK message adapter
   - \`src/remote/remotePermissionBridge.ts\`: Permission bridge

3. **Bridge System**
   - \`src/bridge/bridgeMain.ts\`: Main bridge loop (3001 lines)
   - \`src/bridge/bridgeApi.ts\`: API client
   - \`src/bridge/types.ts\`: Type definitions
   - \`src/bridge/sessionRunner.ts\`: Session spawning
   - \`src/bridge/createSession.ts\`: Session creation

4. **Server Implementation**
   - \`src/server/directConnectManager.ts\`: Direct connection manager
   - \`src/server/types.ts\`: Server types
   - \`src/server/web/\`: Web interface

5. **Upstream Proxy**
   - \`src/upstreamproxy/upstreamproxy.ts\`: Proxy configuration
   - \`src/upstreamproxy/relay.ts\`: WebSocket relay

6. **Command System**
   - \`src/commands.ts\`: Command registry (758 lines)
   - \`src/cli/print.ts\`: Output formatting (5596 lines)
   - \`src/cli/structuredIO.ts\`: Structured I/O
   - \`src/cli/remoteIO.ts\`: Remote I/O

7. **Supporting Systems**
   - \`src/buddy/\`: Companion/sidekick feature
   - \`src/moreright/\`: Extended permissions
   - \`src/cli/\`: CLI utilities

### Related Documentation

- MCP Specification: https://modelcontextprotocol.io
- Claude Code Documentation: https://docs.anthropic.com/claude-code
- Aegis Architecture: \`/home/bubuntu/.openclaw/workspace-aegis/references/\`

---

*Analysis completed: 2026-03-31*
*Analyst: Hephaestus (subagent cc-analysis-network-2)*
