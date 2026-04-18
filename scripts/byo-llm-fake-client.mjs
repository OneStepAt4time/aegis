import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

function parsePositiveInt(rawValue, fallback) {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function joinBaseUrl(baseUrl, suffix) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(suffix.replace(/^\/+/, ''), normalizedBase).toString();
}

async function main() {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  const model = process.env.ANTHROPIC_DEFAULT_MODEL ?? process.env.ANTHROPIC_DEFAULT_FAST_MODEL;
  const timeoutMs = parsePositiveInt(process.env.API_TIMEOUT_MS, 5_000);
  const holdMs = parsePositiveInt(process.env.BYO_LLM_FAKE_CLIENT_HOLD_MS, 1_500);
  const prompt = process.env.BYO_LLM_FAKE_CLIENT_PROMPT ?? 'Aegis BYO LLM smoke';

  if (!baseUrl) {
    throw new Error('ANTHROPIC_BASE_URL is required');
  }
  if (!model) {
    throw new Error('ANTHROPIC_DEFAULT_MODEL or ANTHROPIC_DEFAULT_FAST_MODEL is required');
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };

  const response = await fetch(joinBaseUrl(baseUrl, 'chat/completions'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed with HTTP ${response.status}: ${text}`);
  }

  console.log(`BYO LLM fake client success: ${text}`);
  await delay(holdMs);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
