/**
 * Issue #2795: Detect if the process is running inside a Docker container.
 * Checks for /.dockerenv and /proc/1/cgroup for container indicators.
 */
import { existsSync, readFileSync } from 'node:fs';

export function detectDocker(): boolean {
  try {
    if (existsSync('/.dockerenv')) return true;
  } catch { /* fs unavailable */ }
  try {
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
    if (/docker|containerd/.test(cgroup)) return true;
  } catch { /* /proc/1/cgroup not readable — not in container */ }
  return false;
}
