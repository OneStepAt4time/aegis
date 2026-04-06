import { spawn, execFileSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distServerPath = path.join(repoRoot, 'dist', 'server.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a free TCP port')));
        return;
      }
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function stringifyLogs(stdout, stderr) {
  const sections = [];
  if (stdout.trim()) sections.push(`stdout:\n${stdout.trimEnd()}`);
  if (stderr.trim()) sections.push(`stderr:\n${stderr.trimEnd()}`);
  return sections.length > 0 ? sections.join('\n\n') : 'no child process output captured';
}

async function waitForHealth(url, child, stdoutRef, stderrRef) {
  const deadline = Date.now() + 20_000;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Aegis exited before becoming healthy (code=${child.exitCode}, signal=${child.signalCode ?? 'none'})\n${stringifyLogs(stdoutRef.value, stderrRef.value)}`,
      );
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      lastError = new Error(`Health endpoint returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(`Timed out waiting for ${url}: ${detail}\n${stringifyLogs(stdoutRef.value, stderrRef.value)}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Expected HTTP 200 from ${url}, received ${response.status} with payload ${JSON.stringify(payload)}`);
  }
  return payload;
}

function assertHealthPayload(payload) {
  if (payload == null || typeof payload !== 'object') {
    throw new Error(`Expected JSON object from /v1/health, received ${typeof payload}`);
  }

  if (payload.status !== 'ok') {
    throw new Error(`Expected health status "ok", received ${JSON.stringify(payload.status)}`);
  }

  if (typeof payload.version !== 'string' || payload.version.length === 0) {
    throw new Error('Health payload is missing a non-empty version string');
  }

  if (typeof payload.uptime !== 'number' || Number.isNaN(payload.uptime)) {
    throw new Error('Health payload is missing a numeric uptime');
  }

  if (!payload.sessions || typeof payload.sessions !== 'object') {
    throw new Error('Health payload is missing sessions information');
  }

  if (typeof payload.sessions.active !== 'number' || typeof payload.sessions.total !== 'number') {
    throw new Error('Health payload sessions counters must be numeric');
  }

  if (!payload.tmux || typeof payload.tmux !== 'object') {
    throw new Error('Health payload is missing tmux diagnostics');
  }

  if (typeof payload.timestamp !== 'string' || Number.isNaN(Date.parse(payload.timestamp))) {
    throw new Error('Health payload is missing a valid ISO timestamp');
  }
}

function assertEmptySessionsPayload(payload) {
  if (payload == null || typeof payload !== 'object') {
    throw new Error(`Expected JSON object from /v1/sessions, received ${typeof payload}`);
  }

  if (!Array.isArray(payload.sessions)) {
    throw new Error('Sessions payload is missing a sessions array');
  }

  if (payload.sessions.length !== 0) {
    throw new Error(`Expected zero sessions at startup, received ${payload.sessions.length}`);
  }

  if (!payload.pagination || typeof payload.pagination !== 'object') {
    throw new Error('Sessions payload is missing pagination metadata');
  }

  if (payload.pagination.total !== 0) {
    throw new Error(`Expected pagination.total to be 0, received ${JSON.stringify(payload.pagination.total)}`);
  }

  if (payload.pagination.page !== 1) {
    throw new Error(`Expected pagination.page to be 1, received ${JSON.stringify(payload.pagination.page)}`);
  }
}

async function stopChild(child, stdoutRef, stderrRef) {
  if (child.exitCode !== null) {
    return child.exitCode;
  }

  child.kill('SIGTERM');

  const exitCode = await Promise.race([
    new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 0))),
    delay(10_000).then(() => '__timeout__'),
  ]);

  if (exitCode === '__timeout__') {
    child.kill('SIGKILL');
    throw new Error(`Aegis did not shut down within 10s after SIGTERM\n${stringifyLogs(stdoutRef.value, stderrRef.value)}`);
  }

  return exitCode;
}

try {
  await access(distServerPath);

  const port = await getFreePort();
  const stateDir = await mkdtemp(path.join(tmpdir(), 'aegis-uat-'));
  const tmuxSession = `aegis-uat-${port}`;
  const stdoutRef = { value: '' };
  const stderrRef = { value: '' };

  const child = spawn(process.execPath, [distServerPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AEGIS_HOST: '127.0.0.1',
      AEGIS_PORT: String(port),
      AEGIS_STATE_DIR: stateDir,
      AEGIS_TMUX_SESSION: tmuxSession,
      FORCE_COLOR: '0',
      // Issue #1099: explicitly disable auth for smoke test to prevent
      // environment-auth-token from causing 401 in local smoke test
      AEGIS_AUTH_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutRef.value += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderrRef.value += chunk;
  });

  const healthUrl = `http://127.0.0.1:${port}/v1/health`;
  const sessionsUrl = `http://127.0.0.1:${port}/v1/sessions`;
  let exitCode = 1;

  try {
    const payload = await waitForHealth(healthUrl, child, stdoutRef, stderrRef);
    assertHealthPayload(payload);
    const sessionsPayload = await fetchJson(sessionsUrl);
    assertEmptySessionsPayload(sessionsPayload);
    exitCode = await stopChild(child, stdoutRef, stderrRef);
  } finally {
    try {
      execFileSync('tmux', ['kill-session', '-t', tmuxSession], { stdio: 'ignore' });
    } catch {
      // Best-effort cleanup. The runner is ephemeral and the session may already be gone.
    }

    await rm(stateDir, { recursive: true, force: true });
  }

  if (exitCode !== 0) {
    throw new Error(`Aegis exited with code ${exitCode} after smoke shutdown\n${stringifyLogs(stdoutRef.value, stderrRef.value)}`);
  }

  console.log(`Smoke UAT passed via ${healthUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}