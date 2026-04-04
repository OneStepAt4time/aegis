import Fastify from 'fastify';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function writePidFile(stateDir: string): string {
  try {
    const pidFilePath = path.join(stateDir, 'aegis.pid');
    writeFileSync(pidFilePath, String(process.pid));
    return pidFilePath;
  } catch {
    return '';
  }
}

export function removePidFile(pidFilePath: string): void {
  try {
    if (pidFilePath) unlinkSync(pidFilePath);
  } catch {
    // non-critical
  }
}

async function readPidFile(stateDir: string): Promise<number | null> {
  try {
    const p = path.join(stateDir, 'aegis.pid');
    const content = (await fs.readFile(p, 'utf-8')).trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPpid(pid: number): number {
  const status = readFileSync(`/proc/${pid}/status`, 'utf-8');
  const match = status.match(/^PPid:\s+(\d+)/m);
  if (!match) throw new Error(`no PPid line in /proc/${pid}/status`);
  return parseInt(match[1], 10);
}

function isAncestorPid(pid: number): boolean {
  try {
    let current = process.ppid;
    for (let depth = 0; depth < 10 && current > 1; depth++) {
      if (current === pid) return true;
      try {
        current = readPpid(current);
      } catch {
        break;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

async function waitForPortRelease(port: number, maxWaitMs = 5000): Promise<void> {
  const net = await import('node:net');
  const start = Date.now();
  let delay = 200;

  while (Date.now() - start < maxWaitMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.createServer();
        sock.once('error', reject);
        sock.listen(port, '127.0.0.1', () => {
          sock.close();
          reject(new Error('port free'));
        });
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'port free') return;
    }
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 1000);
  }
}

async function killStalePortHolder(port: number, stateDir: string): Promise<boolean> {
  await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));

  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8', timeout: 5000 }).trim();
    if (!output) return false;

    const pids = output.split('\n').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
    if (pids.length === 0) return false;

    let killed = false;

    for (const pid of pids) {
      if (pid === process.pid) continue;

      if (isAncestorPid(pid)) {
        console.warn(`EADDRINUSE recovery: skipping ancestor PID ${pid} on port ${port}`);
        continue;
      }

      const pidFilePid = await readPidFile(stateDir);
      if (pidFilePid !== null && pid === pidFilePid && pid !== process.pid) {
        console.warn(`EADDRINUSE recovery: skipping peer Aegis PID ${pid} (PID file match) on port ${port}`);
        continue;
      }

      if (!pidExists(pid)) continue;

      console.warn(`EADDRINUSE recovery: killing stale process PID ${pid} on port ${port}`);

      try {
        process.kill(pid, 'SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (!pidExists(pid)) {
          killed = true;
          continue;
        }
      } catch {
        // process may have exited between checks
      }

      try {
        process.kill(pid, 'SIGKILL');
        killed = true;
      } catch {
        // already dead
      }
    }

    if (killed) {
      await waitForPortRelease(port);
    }

    return killed;
  } catch {
    return false;
  }
}

export async function listenWithRetry(
  app: ReturnType<typeof Fastify>,
  port: number,
  host: string,
  stateDir: string,
  maxRetries = 1,
): Promise<void> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await app.listen({ port, host });
      return;
    } catch (err: unknown) {
      if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') || attempt >= maxRetries) {
        throw err;
      }
      console.error(`EADDRINUSE on port ${port} - attempting recovery (attempt ${attempt + 1}/${maxRetries})`);
      const killed = await killStalePortHolder(port, stateDir);
      if (!killed) {
        console.error(`EADDRINUSE recovery failed: no stale process found on port ${port}`);
        throw err;
      }
    }
  }
}
