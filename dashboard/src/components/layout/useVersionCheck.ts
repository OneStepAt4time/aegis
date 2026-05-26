/**
 * layout/useVersionCheck.ts — Version loading and update checking.
 */

import { useState, useEffect } from 'react';
import { logger } from '../../utils/logger';
import { checkForUpdates, getHealth, type UpdateCheckResult } from '../../api/client';
import {
  UPDATE_CHECK_CACHE_KEY,
  UPDATE_CHECK_TTL_MS,
} from './types';

interface CachedUpdateCheckResult extends UpdateCheckResult {
  checkedAt: number;
  sourceVersion: string;
}

function readCachedUpdate(version: string): UpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(UPDATE_CHECK_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedUpdateCheckResult;
    if (cached.sourceVersion !== version) return null;
    if (Date.now() - cached.checkedAt > UPDATE_CHECK_TTL_MS) return null;
    return {
      currentVersion: cached.currentVersion,
      latestVersion: cached.latestVersion,
      updateAvailable: cached.updateAvailable,
      releaseUrl: cached.releaseUrl,
    };
  } catch {
    return null;
  }
}

function writeCachedUpdate(version: string, result: UpdateCheckResult): void {
  try {
    const payload: CachedUpdateCheckResult = {
      ...result,
      checkedAt: Date.now(),
      sourceVersion: version,
    };
    localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

export function useVersionCheck() {
  const [aegisVersion, setAegisVersion] = useState<string>('...');
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  async function runUpdateCheck(version: string, force: boolean): Promise<void> {
    if (!version || version === '...' || version === 'unknown') return;

    if (!force) {
      const cached = readCachedUpdate(version);
      if (cached) {
        setUpdateResult(cached);
        setUpdateCheckError(null);
        return;
      }
    }

    setUpdateCheckLoading(true);
    setUpdateCheckError(null);
    try {
      const result = await checkForUpdates(version);
      setUpdateResult(result);
      writeCachedUpdate(version, result);
    } catch (err) {
      setUpdateCheckError(err instanceof Error ? err.message : 'Failed to check updates');
      setUpdateResult(null);
    } finally {
      setUpdateCheckLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadVersion = async () => {
      try {
        const health = await getHealth(controller.signal);
        if (!cancelled) {
          setAegisVersion(health.version);
          void runUpdateCheck(health.version, false);
        }
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        logger.warn('layout', 'Failed to load Aegis version', err);
        if (!cancelled) setAegisVersion('unknown');
      }
    };

    void loadVersion();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const handleCheckUpdates = async () => {
    await runUpdateCheck(aegisVersion, true);
  };

  return {
    aegisVersion,
    updateCheckLoading,
    updateCheckError,
    updateResult,
    handleCheckUpdates,
  };
}
