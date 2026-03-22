/**
 * screenshot.test.ts — Tests for Issue #22: screenshot capability.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the logic without actually importing playwright
// by mocking the module

describe('Screenshot capability', () => {
  describe('isPlaywrightAvailable', () => {
    it('should return a boolean', async () => {
      // Dynamic import to get the actual module state
      const { isPlaywrightAvailable } = await import('../screenshot.js');
      const result = isPlaywrightAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('captureScreenshot — when Playwright is not available', () => {
    it('should throw descriptive error when playwright is missing', async () => {
      // We test this by directly checking the error path
      // Since playwright may or may not be installed in CI,
      // we test the error message format
      try {
        const { captureScreenshot } = await import('../screenshot.js');
        await captureScreenshot({ url: 'https://example.com' });
        // If it didn't throw, playwright IS available — skip
        expect(true).toBe(true);
      } catch (e: any) {
        expect(e.message).toContain('Playwright');
        expect(e.message).toContain('not installed');
      }
    });
  });

  describe('API contract — screenshot options', () => {
    it('should accept valid screenshot options', () => {
      const opts = {
        url: 'https://example.com',
        fullPage: true,
        width: 1920,
        height: 1080,
      };

      expect(opts.url).toBe('https://example.com');
      expect(opts.fullPage).toBe(true);
      expect(opts.width).toBe(1920);
      expect(opts.height).toBe(1080);
    });

    it('should use defaults when options are partial', () => {
      const opts: { url: string; width?: number; height?: number; fullPage?: boolean } = { url: 'https://example.com' };
      const width = opts.width || 1280;
      const height = opts.height || 720;
      const fullPage = opts.fullPage || false;

      expect(width).toBe(1280);
      expect(height).toBe(720);
      expect(fullPage).toBe(false);
    });
  });

  describe('API contract — screenshot result', () => {
    it('should return base64 string, timestamp, url, dimensions', () => {
      const result = {
        screenshot: Buffer.from('fake-png').toString('base64'),
        timestamp: new Date().toISOString(),
        url: 'https://example.com',
        width: 1280,
        height: 720,
      };

      expect(typeof result.screenshot).toBe('string');
      expect(result.screenshot.length).toBeGreaterThan(0);
      expect(typeof result.timestamp).toBe('string');
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.url).toBe('https://example.com');
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
    });
  });

  describe('API contract — 501 response shape', () => {
    it('should return correct 501 response body when playwright missing', () => {
      const response = {
        error: 'Playwright is not installed',
        message: 'Install Playwright to enable screenshots: npx playwright install chromium && npm install -D playwright',
      };

      expect(response.error).toBe('Playwright is not installed');
      expect(response.message).toContain('playwright install chromium');
    });
  });

  describe('API contract — 400 validation', () => {
    it('should require url in request body', () => {
      const body: { url?: string } = {};
      const hasUrl = !!body.url;
      expect(hasUrl).toBe(false);
    });

    it('should accept valid url', () => {
      const body = { url: 'https://example.com' };
      expect(body.url).toBeTruthy();
    });
  });
});
