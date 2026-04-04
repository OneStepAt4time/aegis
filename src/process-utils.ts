import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const SUBPROCESS_TIMEOUT_MS = 5_000;

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parsePidLines(output: string): number[] {
  return [...new Set(
    output
      .trim()
      .split(/\r?\n/)
      .map(line => parseInt(line.trim(), 10))
      .filter(pid => Number.isInteger(pid) && pid > 0),
  )];
}

export function buildWindowsFindPidOnPortScript(port: number): string {
  return [
    `Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue`,
    'Select-Object -ExpandProperty OwningProcess -Unique',
  ].join(' | ');
}

export function buildWindowsReadParentPidScript(pid: number): string {
  return [
    `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    'Select-Object -ExpandProperty ParentProcessId',
  ].join(' | ');
}

export async function findPidOnPort(port: number): Promise<number[]> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];

  try {
    if (process.platform === 'win32') {
      const script = buildWindowsFindPidOnPortScript(port);

      const stdout = await runCommand('powershell', ['-NoProfile', '-Command', script]);
      return parsePidLines(stdout);
    }

    const stdout = await runCommand('lsof', ['-ti', `tcp:${port}`]);
    return parsePidLines(stdout);
  } catch {
    return [];
  }
}

export async function readParentPid(pid: number): Promise<number | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  try {
    if (process.platform === 'win32') {
      const script = buildWindowsReadParentPidScript(pid);

      const stdout = await runCommand('powershell', ['-NoProfile', '-Command', script]);
      const parent = parseInt(stdout.trim(), 10);
      return Number.isInteger(parent) && parent > 0 ? parent : null;
    }

    if (process.platform !== 'linux') {
      return null;
    }

    const status = await readFile(`/proc/${pid}/status`, 'utf-8');
    const match = status.match(/^PPid:\s+(\d+)/m);
    if (!match) return null;

    const parent = parseInt(match[1], 10);
    return Number.isInteger(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}
