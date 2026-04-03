type SessionRead = { status: string; messages: Array<{ role: string; text?: string }> };

const BASE_URL = process.env.AEGIS_BASE_URL ?? "http://127.0.0.1:9100";

async function runCiTask(workDir: string, prompt: string): Promise<number> {
  const created = await fetch(`${BASE_URL}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workDir, name: "ci-runner", prompt }),
  });
  if (!created.ok) return 2;
  const { id } = (await created.json()) as { id: string };

  const timeoutAt = Date.now() + 15 * 60_000;
  while (Date.now() < timeoutAt) {
    await new Promise((r) => setTimeout(r, 3000));
    const read = await fetch(`${BASE_URL}/v1/sessions/${id}/read`);
    const data = (await read.json()) as SessionRead;

    if (data.status === "permission_prompt" || data.status === "bash_approval") {
      await fetch(`${BASE_URL}/v1/sessions/${id}/approve`, { method: "POST" });
      continue;
    }
    if (data.status === "idle") {
      const transcript = data.messages.map((m) => `${m.role}: ${m.text ?? ""}`).join("\n");
      console.log(transcript);
      return /fail|error/i.test(transcript) ? 1 : 0;
    }
  }
  return 3;
}

const workDir = process.argv[2] ?? process.cwd();
const prompt = process.argv[3] ?? "Run tests and report pass/fail summary.";
runCiTask(workDir, prompt).then((code) => process.exit(code));
