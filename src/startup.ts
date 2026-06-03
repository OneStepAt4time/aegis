import Fastify from 'fastify';
import fs from 'node:fs/promises';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { secureFilePermissions } from './file-utils.js';
import { StructuredLogger } from './logger.js';

const log = new StructuredLogger();
import { findPidOnPort, readParentPid } from './process-utils.js';

/** Thrown when aegis.pid indicates another Aegis process is alive. */
export class AegisAlreadyRunningError extends Error {
  constructor(pid: number) {
    super(`Aegis is already running (PID ${pid}) — see \`ag status\``);
    this.name = 'AegisAlreadyRunningError';
  }
}

/** Thrown when the listen port is held and cannot be reclaimed. */
export class AegisPortInUseError extends Error {
  constructor(port: number) {
    super(`Port ${port} is in use by another process — Aegis is already running`);
    this.name = 'AegisPortInUseError';
  }
}

export async function writePidFile(stateDir: string): Promise<string> {
  try {
    const pidFilePath = path.join(stateDir, 'aegis.pid');
    writeFileSync(pidFilePath, String(process.pid), { mode: 0o600 });
    await secureFilePermissions(pidFilePath);
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

/** Read parent PID with cross-platform fallback. */
export async function readPpid(pid: number): Promise<number> {
  const parent = await readParentPid(pid);
  if (parent === null) {
    throw new Error(`no parent PID available for process ${pid}`);
  }
  return parent;
}

async function isAncestorPid(pid: number): Promise<boolean> {
  try {
    let current = process.ppid;
    for (let depth = 0; depth < 10 && current > 1; depth++) {
      if (current === pid) return true;
      try {
        current = await readPpid(current);
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
    const pids = await findPidOnPort(port);
    if (pids.length === 0) return false;

    let killed = false;

    for (const pid of pids) {
      if (pid === process.pid) continue;

      if (await isAncestorPid(pid)) {
        log.warn({ component: 'startup', operation: 'skipAncestorPid', attributes: { pid, port } });
        continue;
      }

      const pidFilePid = await readPidFile(stateDir);
      if (pidFilePid !== null && pid === pidFilePid && pid !== process.pid) {
        log.warn({ component: 'startup', operation: 'skipPeerPid', attributes: { pid, port } });
        continue;
      }

      if (!pidExists(pid)) continue;

      log.warn({ component: 'startup', operation: 'killingStalePid', attributes: { pid, port } });

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

/**
 * Acquire the PID lockfile before starting expensive service initialization.
 *
 * Checks whether `aegis.pid` in `stateDir` references a live process.
 * If it does, throws {@link AegisAlreadyRunningError} so the caller
 * can exit gracefully before initializing services that write state files.
 *
 * If the referenced PID is dead (or the file is missing/stale), removes
 * the stale file and writes the current process PID.
 */
export async function acquirePidLock(stateDir: string): Promise<string> {
  try {
    const pidFilePath = path.join(stateDir, 'aegis.pid');
    const existingPid = await readPidFile(stateDir);

    if (existingPid !== null) {
      if (pidExists(existingPid)) {
        throw new AegisAlreadyRunningError(existingPid);
      }
      // Stale PID file — clean it up so we don't leave cruft behind
      try {
        await fs.unlink(pidFilePath);
        log.warn({
          component: 'startup',
          operation: 'removedStalePidFile',
          attributes: { pid: existingPid, path: pidFilePath },
        });
      } catch {
        // ignore unlink errors (may not exist or may be unreadable)
      }
    }

    const written = await writePidFile(stateDir);
    return written;
  } catch (err) {
    if (err instanceof AegisAlreadyRunningError) {
      throw err;
    }
    // If we can't read or write the PID file, treat it as non-blocking
    // (dev shells may lack write access to the state dir).
    log.warn({
      component: 'startup',
      operation: 'pidFileUnavailable',
      attributes: { error: err instanceof Error ? err.message : String(err) },
    });
    return '';
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
      log.error({ component: 'startup', operation: 'addrInUseRecovery', attributes: { port, attempt: attempt + 1, maxRetries } });
      const killed = await killStalePortHolder(port, stateDir);
      if (!killed) {
        // #3346: Better error message when a peer Aegis is already running
        log.error({ component: 'startup', operation: 'addrInUsePeerRunning', attributes: { port } });
        log.error({ component: 'startup', operation: 'addrInUseHintConnect', attributes: { port } });
        log.error({ component: 'startup', operation: 'addrInUseHintStop', attributes: { port } });
        throw new AegisPortInUseError(port);
      }
    }
  }
}
