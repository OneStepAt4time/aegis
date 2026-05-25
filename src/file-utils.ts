import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
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
    await chmod(filePath, 0o600);
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
