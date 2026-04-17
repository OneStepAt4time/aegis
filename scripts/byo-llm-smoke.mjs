import { spawn, execFileSync } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distServerPath = path.join(repoRoot, 'dist', 'server.js');
const scratchRoot = path.join(repoRoot, '.tmp', 'byo-llm-smoke');

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
  let lastError = 'unknown error';

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
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}\n${stringifyLogs(stdoutRef.value, stderrRef.value)}`);
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

async function main() {
  await access(distServerPath);
  await access(path.join(repoRoot, 'scripts', 'byo-llm-fake-client.mjs'));

  const aegisPort = await getFreePort();
  const mockPort = await getFreePort();
  const scratchDir = path.join(scratchRoot, `${process.pid}-${aegisPort}`);
  const stateDir = path.join(scratchDir, 'state');
  const workDir = path.join(scratchDir, 'workdir');
  await mkdir(stateDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const expectedToken = `byo-llm-smoke-token-${mockPort}`;
  const expectedModel = 'openai/gpt-4.1-mini';
  const expectedPrompt = 'Aegis BYO LLM smoke';
  const mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;

  let resolveRequest;
  const requestPromise = new Promise((resolve) => {
    resolveRequest = resolve;
  });

  const mockServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      const parsedBody = JSON.parse(body);
      resolveRequest({
        url: url.pathname,
        authorization: req.headers.authorization ?? '',
        payload: parsedBody,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-byo-llm-smoke',
        object: 'chat.completion',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'mock-ok' },
        }],
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: expectedModel, object: 'model' }] }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    mockServer.once('error', reject);
    mockServer.listen(mockPort, '127.0.0.1', resolve);
  });

  const stdoutRef = { value: '' };
  const stderrRef = { value: '' };
  const tmuxSession = `aegis-byo-llm-${aegisPort}`;
  const authToken = `aegis-byo-auth-${aegisPort}`;

  const child = spawn(process.execPath, [distServerPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AEGIS_HOST: '127.0.0.1',
      AEGIS_PORT: String(aegisPort),
      AEGIS_STATE_DIR: stateDir,
      AEGIS_TMUX_SESSION: tmuxSession,
      AEGIS_AUTH_TOKEN: authToken,
      MANUS_AUTH_TOKEN: '',
      FORCE_COLOR: '0',
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

  const baseUrl = `http://127.0.0.1:${aegisPort}`;
  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };

  let sessionId;

  try {
    await waitForHealth(`${baseUrl}/v1/health`, child, stdoutRef, stderrRef);

    const createResponse = await fetch(`${baseUrl}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workDir,
        name: 'byo-llm-smoke',
        claudeCommand: 'node scripts/byo-llm-fake-client.mjs',
        env: {
          ANTHROPIC_BASE_URL: mockBaseUrl,
          ANTHROPIC_AUTH_TOKEN: expectedToken,
          ANTHROPIC_DEFAULT_MODEL: expectedModel,
          ANTHROPIC_DEFAULT_FAST_MODEL: 'openai/gpt-4.1-nano',
          API_TIMEOUT_MS: '5000',
        },
      }),
    });

    const createPayload = await createResponse.json().catch(() => null);
    if (!createResponse.ok) {
      throw new Error(`Failed to create smoke session: HTTP ${createResponse.status} ${JSON.stringify(createPayload)}`);
    }
    sessionId = createPayload?.id;

    const request = await Promise.race([
      requestPromise,
      delay(15_000).then(() => '__timeout__'),
    ]);

    if (request === '__timeout__') {
      let paneText = '';
      if (sessionId) {
        try {
          const paneResponse = await fetch(`${baseUrl}/v1/sessions/${sessionId}/pane`, { headers });
          paneText = await paneResponse.text();
        } catch {
          // ignore debug fetch failures
        }
      }
      throw new Error(`Timed out waiting for the OpenAI-compatible mock request\n${paneText}`);
    }

    if (request.authorization !== `Bearer ${expectedToken}`) {
      throw new Error(`Expected bearer auth for mock request, received ${JSON.stringify(request.authorization)}`);
    }

    if (request.payload?.model !== expectedModel) {
      throw new Error(`Expected model ${expectedModel}, received ${JSON.stringify(request.payload?.model)}`);
    }

    const firstMessage = request.payload?.messages?.[0]?.content;
    if (firstMessage !== expectedPrompt) {
      throw new Error(`Expected prompt ${JSON.stringify(expectedPrompt)}, received ${JSON.stringify(firstMessage)}`);
    }

    const exitCode = await stopChild(child, stdoutRef, stderrRef);
    if (exitCode !== 0) {
      throw new Error(`Aegis exited with code ${exitCode}\n${stringifyLogs(stdoutRef.value, stderrRef.value)}`);
    }
  } finally {
    try {
      await stopChild(child, stdoutRef, stderrRef);
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Best-effort cleanup only.
      }
    }
    try {
      execFileSync('tmux', ['-L', `aegis-${child.pid}`, 'kill-server'], { stdio: 'ignore' });
    } catch {
      // Best-effort cleanup only.
    }
    try {
      await new Promise((resolve, reject) => mockServer.close((error) => error ? reject(error) : resolve()));
    } catch {
      // Ignore mock server shutdown errors during cleanup.
    }
    await rm(scratchDir, { recursive: true, force: true });
  }

  console.log(`BYO LLM smoke passed against ${mockBaseUrl}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
