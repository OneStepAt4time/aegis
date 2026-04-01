/**
 * screenshot.ts — Headless screenshot capture via Playwright.
 *
 * Issue #22: Visual verification for CC sessions.
 * Uses Playwright if available; returns 501 Not Implemented otherwise.
 */

let playwrightAvailable = false;
let chromium: typeof import('playwright').chromium | null = null;

// Lazy-load Playwright — only fails at startup, not import time
try {
  const pw = await import('playwright');
  chromium = pw.chromium;
  playwrightAvailable = true;
} catch { /* playwright not installed — screenshot feature disabled */
  playwrightAvailable = false;
}

export interface ScreenshotOptions {
  url: string;
  fullPage?: boolean;
  width?: number;
  height?: number;
  /** Chromium --host-resolver-rules value to pin DNS (prevents TOCTOU rebinding). */
  hostResolverRule?: string;
}

export interface ScreenshotResult {
  screenshot: string;  // base64-encoded PNG
  timestamp: string;
  url: string;
  width: number;
  height: number;
}

/**
 * Capture a screenshot of the given URL using headless Chromium.
 * Returns the result or throws if Playwright is not available.
 */
export async function captureScreenshot(opts: ScreenshotOptions): Promise<ScreenshotResult> {
  if (!playwrightAvailable || !chromium) {
    throw new Error(
      'Playwright is not installed. Install it with: npx playwright install chromium && npm install -D playwright',
    );
  }

  const launchOptions: Record<string, unknown> = { headless: true };
  if (opts.hostResolverRule) {
    launchOptions.args = [`--host-resolver-rules=${opts.hostResolverRule}`];
  }
  const browser = await chromium.launch(launchOptions as Parameters<typeof chromium.launch>[0]);
  try {
    const context = await browser.newContext({
      viewport: {
        width: opts.width || 1280,
        height: opts.height || 720,
      },
    });
    const page = await context.newPage();

    await page.goto(opts.url, { waitUntil: 'load', timeout: 30_000 });

    const buffer = await page.screenshot({
      fullPage: opts.fullPage || false,
      type: 'png',
    });

    await context.close();

    return {
      screenshot: buffer.toString('base64'),
      timestamp: new Date().toISOString(),
      url: opts.url,
      width: opts.width || 1280,
      height: opts.height || 720,
    };
  } finally {
    await browser.close();
  }
}

/** Check if Playwright is available for screenshot capture. */
export function isPlaywrightAvailable(): boolean {
  return playwrightAvailable;
}
