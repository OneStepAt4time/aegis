/**
 * Multi-Session Pipeline Example
 *
 * Demonstrates creating multiple Aegis sessions in parallel, polling them
 * all to completion, and collecting results.
 *
 * Usage:
 *   npx tsx examples/standalone/multi-session-pipeline.ts /path/to/project
 *
 * Environment variables:
 *   AEGIS_BASE_URL  — Aegis server URL (default: http://127.0.0.1:9100)
 *   AEGIS_AUTH_TOKEN — Bearer token for authentication (default: none)
 */

const BASE_URL = process.env.AEGIS_BASE_URL ?? "http://127.0.0.1:9100";
const AUTH_TOKEN = process.env.AEGIS_AUTH_TOKEN;
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes per session

interface HeadersInit {
  [key: string]: string;
}

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) h["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

interface SessionCreateResponse {
  id: string;
  status: string;
}

interface SessionMessage {
  role: string;
  text?: string;
}

interface SessionReadResponse {
  status: string;
  messages: SessionMessage[];
}

/** Create a single Aegis session. */
async function createSession(
  workDir: string,
  name: string,
  prompt: string
): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ workDir, name, prompt }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create session "${name}": ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as SessionCreateResponse;
  console.log(`✅ Created session: ${name} (${data.id})`);
  return data.id;
}

/** Create multiple sessions via batch endpoint. */
async function createBatch(
  sessions: Array<{ workDir: string; name: string; prompt: string }>
): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/v1/sessions/batch`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ sessions }),
  });
  if (!res.ok) {
    // Fallback: create sessions one by one
    console.log("⚠️  Batch endpoint unavailable, creating sessions sequentially");
    const ids: string[] = [];
    for (const s of sessions) {
      ids.push(await createSession(s.workDir, s.name, s.prompt));
    }
    return ids;
  }
  const data = (await res.json()) as { sessions: Array<{ id: string }> };
  return data.sessions.map((s) => s.id);
}

/** Poll a session until idle or timeout. Returns last assistant message. */
async function pollSession(sessionId: string): Promise<string> {
  const started = Date.now();

  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/read`, {
      headers: headers(),
    });
    if (!res.ok) continue;

    const data = (await res.json()) as SessionReadResponse;

    // Auto-approve permission prompts
    if (
      data.status === "permission_prompt" ||
      data.status === "bash_approval"
    ) {
      await fetch(`${BASE_URL}/v1/sessions/${sessionId}/approve`, {
        method: "POST",
        headers: headers(),
      });
      continue;
    }

    if (data.status === "idle") {
      const lastMsg = [...data.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      return lastMsg?.text?.trim() ?? "(no assistant response)";
    }
  }

  throw new Error(`Session ${sessionId} timed out after ${MAX_WAIT_MS / 1000}s`);
}

/** Kill a session. */
async function killSession(sessionId: string): Promise<void> {
  await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, {
    method: "DELETE",
    headers: headers(),
  });
}

async function main() {
  const workDir = process.argv[2] ?? process.cwd();

  // Define the tasks to run in parallel
  const tasks = [
    {
      name: "lint-check",
      prompt:
        "Run the linter on this project and report any errors or warnings. Be concise — just list the issues found.",
    },
    {
      name: "test-summary",
      prompt:
        "Run the test suite and provide a brief summary: total tests, passed, failed, skipped. Do not fix anything.",
    },
    {
      name: "dep-audit",
      prompt:
        "Check package.json for outdated or vulnerable dependencies. List any that need attention.",
    },
  ];

  console.log(`\n🚀 Starting ${tasks.length} parallel sessions in ${workDir}\n`);

  // Step 1: Create all sessions
  const sessionIds: string[] = [];
  for (const task of tasks) {
    const id = await createSession(workDir, task.name, task.prompt);
    sessionIds.push(id);
  }

  // Step 2: Poll all sessions in parallel
  console.log(`\n⏳ Polling ${sessionIds.length} sessions...\n`);

  const results = await Promise.allSettled(
    sessionIds.map(async (id, i) => {
      const result = await pollSession(id);
      return { name: tasks[i].name, id, result };
    })
  );

  // Step 3: Display results
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60) + "\n");

  let failed = 0;
  for (const outcome of results) {
    if (outcome.status === "fulfilled") {
      const { name, result } = outcome.value;
      console.log(`📝 ${name}:`);
      console.log(result);
      console.log("");
    } else {
      failed++;
      console.log(`❌ Failed: ${outcome.reason}`);
    }
  }

  // Step 4: Cleanup
  console.log("🧹 Cleaning up sessions...");
  await Promise.allSettled(sessionIds.map((id) => killSession(id)));

  console.log(`\n✨ Done. ${results.length - failed}/${results.length} sessions completed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
