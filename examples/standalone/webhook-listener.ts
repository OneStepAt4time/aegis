/**
 * Webhook Listener Example
 *
 * A minimal HTTP server that receives Aegis webhook events, parses the
 * payload, and logs session state transitions.
 *
 * Usage:
 *   npx tsx examples/standalone/webhook-listener.ts [port]
 *
 * Environment variables:
 *   WEBHOOK_PORT   — Port to listen on (default: 4567)
 *   WEBHOOK_SECRET — Optional HMAC secret for signature verification
 *
 * Expected webhook payload (POST /webhook):
 * {
 *   "event": "session.created" | "session.idle" | "session.error" | ...,
 *   "sessionId": "uuid",
 *   "timestamp": "2026-04-27T12:00:00Z",
 *   "data": { ... }  // event-specific fields
 * }
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";

const PORT = parseInt(process.env.WEBHOOK_PORT ?? "4567", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // optional

// --- Types ---

interface WebhookPayload {
  event: string;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// --- Helpers ---

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Event emoji map for readable console output. */
const EVENT_ICONS: Record<string, string> = {
  "session.created": "🆕",
  "session.idle": "✅",
  "session.error": "❌",
  "session.killed": "💀",
  "session.permission_prompt": "🔓",
  "session.bash_approval": "⚡",
  "session.timeout": "⏰",
  "session.stalled": "🔄",
};

// --- Request Handler ---

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // Health check
  if (method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // Webhook endpoint
  if (method === "POST" && url === "/webhook") {
    const rawBody = await parseBody(req);
    const payload = safeJson(rawBody) as WebhookPayload | null;

    if (!payload || !payload.event || !payload.sessionId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid payload — need event and sessionId" }));
      return;
    }

    // Optional: verify HMAC signature
    const sigHeader = req.headers["x-aegis-signature"];
    if (WEBHOOK_SECRET && sigHeader) {
      const crypto = await import("node:crypto");
      const expected = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");
      if (sigHeader !== `sha256=${expected}`) {
        console.warn("⚠️  Signature mismatch — rejecting webhook");
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }
    }

    // Log the event
    const icon = EVENT_ICONS[payload.event] ?? "📩";
    const ts = new Date(payload.timestamp).toLocaleTimeString();
    console.log(
      `${icon} [${ts}] ${payload.event} — session ${payload.sessionId.slice(0, 8)}...`
    );

    // Log event-specific data
    if (Object.keys(payload.data).length > 0) {
      console.log(`   Data: ${JSON.stringify(payload.data, null, 2).split("\n").join("\n   ")}`);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: payload.event }));
    return;
  }

  // Catch-all
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found. POST to /webhook or GET /health" }));
}

// --- Start Server ---

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log("\n" + "=".repeat(50));
  console.log("  Aegis Webhook Listener");
  console.log("=".repeat(50));
  console.log(`  Listening on: http://localhost:${PORT}`);
  console.log(`  Webhook URL:  http://localhost:${PORT}/webhook`);
  console.log(`  Health check: http://localhost:${PORT}/health`);
  if (WEBHOOK_SECRET) {
    console.log(`  HMAC secret:  configured ✓`);
  }
  console.log("=".repeat(50));
  console.log("  Waiting for events... (Ctrl+C to stop)\n");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use. Set WEBHOOK_PORT to use a different port.`);
  } else {
    console.error("❌ Server error:", err.message);
  }
  process.exit(1);
});
