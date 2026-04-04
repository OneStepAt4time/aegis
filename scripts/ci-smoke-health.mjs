import { setTimeout as delay } from 'node:timers/promises';

const url = process.env.AEGIS_HEALTH_URL ?? 'http://127.0.0.1:9100/v1/health';
const timeoutMs = Number.parseInt(process.env.AEGIS_SMOKE_TIMEOUT_MS ?? '30000', 10);
const intervalMs = 1000;

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

async function main() {
  const start = Date.now();
  let lastError = 'unknown error';

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        await delay(intervalMs);
        continue;
      }

      const body = await res.json();
      if (!isObject(body)) {
        throw new Error('health response is not a JSON object');
      }

      if (body.status !== 'ok' && body.status !== 'degraded') {
        throw new Error(`unexpected status: ${String(body.status)}`);
      }

      if (typeof body.version !== 'string' || body.version.length === 0) {
        throw new Error('missing or invalid version');
      }

      if (typeof body.platform !== 'string' || body.platform.length === 0) {
        throw new Error('missing or invalid platform');
      }

      console.log(`Smoke health check passed: status=${body.status}, version=${body.version}, platform=${body.platform}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await delay(intervalMs);
    }
  }

  throw new Error(`health smoke check failed after ${timeoutMs}ms: ${lastError}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
