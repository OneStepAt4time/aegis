const BASE_URL = process.env.AEGIS_BASE_URL ?? "http://127.0.0.1:9100";

async function main() {
  const workDir = process.argv[2] ?? process.cwd();
  const prompt = process.argv[3] ?? "Say hello from Aegis and then stop.";

  const createRes = await fetch(`${BASE_URL}/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workDir, name: "simple-agent", prompt }),
  });
  if (!createRes.ok) throw new Error(`create failed: ${createRes.status}`);

  const { id } = (await createRes.json()) as { id: string };

  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const readRes = await fetch(`${BASE_URL}/v1/sessions/${id}/read`);
    const data = (await readRes.json()) as {
      status: string;
      messages: Array<{ role: string; text?: string }>;
    };
    if (data.status === "idle") {
      const lastAssistant = [...data.messages].reverse().find((m) => m.role === "assistant");
      console.log(lastAssistant?.text ?? "No assistant message found");
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
