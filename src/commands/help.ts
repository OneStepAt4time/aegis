import { write, writeLine, type CliIO } from '../cli-http.js';

export function printHelp(io: CliIO): void {
  const showOidc = process.env.AEGIS_FEATURE_OIDC === '1';
  const authBlock = showOidc ? `
  Auth (OAuth2 device flow):
    ag login               Authenticate via your IdP (requires OIDC config)
    ag logout              Revoke tokens and clear credentials
    ag logout --all        Clear credentials for all servers
    ag whoami              Show current identity and token status

` : '';
  write(io.stdout, `
  ag — Claude Code session bridge (alias: aegis)

  Usage:
    ag                     Start the server (port 9100)
    ag init                Bootstrap + start server + open browser (default)
    ag init --no-start     Bootstrap config only, don't start server
    ag init --yes          Non-interactive bootstrap for CI
    ag init --force        Overwrite existing config (use with caution)
    ag init --no-open      Start server but skip browser open
    ag run "prompt"        Zero-to-session in one command
    ag init --list-templates
    ag init --from-template code-reviewer
    ag doctor              Validate starter templates here or run local diagnostics
    ag "brief"             Create a session and send brief (shorthand)
    ag --port 3000         Custom port
    ag create "brief"      Create a session and send brief
    ag mcp                 Start MCP server (stdio transport)
    ag --help              Show this help

  Init:
    ag init
    ag init --no-start
    ag init --yes
    ag init --list-templates
    ag init --from-template docs-writer

  Create:
    ag create "Build a login page" --cwd /path/to/project
    ag create "Fix the tests"      (uses current directory)
    ag create "..." --passthrough   Bypass all permissions
    ag create "..." --session-id abc  Send to existing session
    --model <model>       Set Claude model
    --effort <level>      Set reasoning effort (low, medium, high, 0.0-1.0)

  Doctor:
    ag doctor              Validate starter templates here, otherwise run local diagnostics
    ag doctor --port 3000  Check a custom API port
    ag doctor --json       Emit machine-readable diagnostics

  MCP server:
    ag mcp                 Start MCP stdio server
    ag mcp --port 3000     Custom Aegis API port
    claude mcp add aegis -- ag mcp

  Sessions:
    ag list                 List active sessions
    ag list --status active  Filter by status
    ag read <id>            Read session output
    ag tail <id>            Follow session output in real-time
    ag send <id> "msg"      Send message to a running session
    ag kill <id>            Terminate a session
    ag approve <id>         Approve a pending tool call
    ag reject <id>          Reject a pending tool call
    ag status               Show server health + session summary

  Update:
    ag update               Check for and apply self-update
    ag update --check       Only check, no update (exit 1 if available)
    ag update --yes         Skip confirmation prompt
    ag update --dry-run      Show what would happen without updating
    ag meta <id> [--set key=val] [--delete key]  Per-session metadata KV store
${authBlock}  Flags:
    --json-logs           Emit structured JSON logs (default: quiet mode)

  Environment variables:
    AEGIS_BASE_URL                 Preferred API base URL for hooks + CLI
    AEGIS_PORT                     Server port (default: 9100)
    AEGIS_HOST                     Server host (default: 127.0.0.1)
    AEGIS_AUTH_TOKEN               Bearer token for API auth
    AEGIS_STATE_DIR                State directory (default: ~/.aegis)
    AEGIS_DASHBOARD_ENABLED        Serve dashboard assets (default: true)
    AEGIS_TG_TOKEN                 Telegram bot token
    AEGIS_TG_GROUP                 Telegram group chat ID
    AEGIS_TG_ALLOWED_USERS         Allowed Telegram user IDs (comma-separated)
    AEGIS_WEBHOOKS                 Webhook URLs (comma-separated)
    AEGIS_OIDC_ISSUER              OIDC issuer URL (for ag login)
    AEGIS_OIDC_CLIENT_ID           OIDC client ID (for ag login)

  API:
    POST /v1/sessions             Create a session
    GET  /v1/sessions             List sessions
    GET  /v1/sessions/:id         Get session
    POST /v1/sessions/:id/send    Send message
    GET  /v1/sessions/:id/read    Read messages
    GET  /v1/sessions/:id/health  Health check
    DEL  /v1/sessions/:id         Kill session
    GET  /v1/health               Server health

  Docs: https://github.com/OneStepAt4time/aegis
  `);
}

