import { execFile } from 'node:child_process';
import { open, type FileHandle } from 'node:fs/promises';
import { StructuredLogger } from './logger.js';
const log = new StructuredLogger();


const PERMISSIONS_TIMEOUT_MS = 5_000;

export function buildWindowsIcaclsArgs(filePath: string, account: string): string[] {
  return [filePath, '/inheritance:r', '/grant:r', `${account}:(R,W)`];
}

function runIcacls(filePath: string, account: string): Promise<void> {
  const args = buildWindowsIcaclsArgs(filePath, account);
  return new Promise((resolve, reject) => {
    execFile('icacls', args, { timeout: PERMISSIONS_TIMEOUT_MS }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function secureFilePermissions(filePath: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'win32') {
    // #4650 follow-up: use a held file descriptor to avoid the TOCTOU race that
    // the prior access+chmod pattern had (the file could be deleted between
    // access() succeeding and chmod() running, producing an unhandled ENOENT
    // rejection that intermittently failed the CI test step). The descriptor
    // survives unlink, so handle.chmod(0o600) either succeeds or throws
    // ENOENT (which we swallow — the file is already gone, no action needed).
    // Non-ENOENT errors (e.g., EACCES on a locked file) are re-thrown so the
    // caller can react.
    let handle: FileHandle | undefined;
    try {
      handle = await open(filePath, 'r');
      await handle.chmod(0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    } finally {
      await handle?.close();
    }
    return;
  }

  const username = process.env.USERNAME;
  if (!username) {
    log.warn({ component: 'file-utils', operation: 'windowsPermSkipped', attributes: { path: filePath, reason: 'USERNAME not set' } });
    return;
  }

  const account = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
  try {
    await runIcacls(filePath, account);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log.warn({ component: 'file-utils', operation: 'windowsPermFailed', attributes: { path: filePath, detail } });
  }
}
