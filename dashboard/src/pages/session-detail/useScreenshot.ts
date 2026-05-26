/**
 * session-detail/useScreenshot.ts — Hook for screenshot capture.
 */

import { useState, useCallback } from 'react';
import { getScreenshot } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { useT } from '../../i18n/context';
import type { ScreenshotState } from './types';

interface UseScreenshotReturn {
  screenshot: ScreenshotState | null;
  capturingScreenshot: boolean;
  screenshotUnsupported: boolean;
  handleCaptureScreenshot: () => Promise<void>;
}

export function useScreenshot(sessionId: string): UseScreenshotReturn {
  const t = useT();
  const addToast = useToastStore((t_store) => t_store.addToast);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);
  const [screenshotUnsupported, setScreenshotUnsupported] = useState(false);

  const handleCaptureScreenshot = useCallback(async () => {
    if (capturingScreenshot) return;
    setCapturingScreenshot(true);
    try {
      const result = await getScreenshot(sessionId);
      setScreenshot({
        image: result.image,
        mimeType: result.mimeType,
        capturedAt: Date.now(),
      });
      addToast('success', t('sessionDetail.screenshotCaptured'));
    } catch (e: unknown) {
      const maybeStatus = typeof e === 'object' && e !== null && 'statusCode' in e
        ? (e as { statusCode?: number }).statusCode
        : undefined;

      if (maybeStatus === 501) {
        setScreenshotUnsupported(true);
        addToast('warning', t('sessionDetail.screenshotUnavailable'), t('sessionDetail.screenshotUnavailableDescription'));
      } else {
        addToast('error', t('sessionDetail.screenshotFailed'), e instanceof Error ? e.message : undefined);
      }
    } finally {
      setCapturingScreenshot(false);
    }
  }, [capturingScreenshot, sessionId, addToast, t]);

  return { screenshot, capturingScreenshot, screenshotUnsupported, handleCaptureScreenshot };
}
