/**
 * api/updates.ts — Version update checking.
 */

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

interface NpmPackageResponse {
  version?: string;
}

const NPM_PACKAGE_NAME = '@onestepat4time/aegis';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`;
const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${NPM_PACKAGE_NAME}`;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function compareSemver(a: string, b: string): number {
  const aParts = normalizeVersion(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const bParts = normalizeVersion(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const left = aParts[i] ?? 0;
    const right = bParts[i] ?? 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const res = await fetch(NPM_REGISTRY_URL, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Update check failed (HTTP ${res.status})`);
  }

  const payload = await res.json() as NpmPackageResponse;
  const latestVersion = normalizeVersion(payload.version ?? currentVersion);
  const normalizedCurrent = normalizeVersion(currentVersion);

  return {
    currentVersion: normalizedCurrent,
    latestVersion,
    updateAvailable: compareSemver(latestVersion, normalizedCurrent) > 0,
    releaseUrl: NPM_PACKAGE_URL,
  };
}
