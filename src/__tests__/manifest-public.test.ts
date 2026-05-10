/**
 * manifest-public.test.ts — Tests for Issue #3092: manifest.json must be publicly accessible.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('PWA manifest.json public access (Issue #3092)', () => {
  describe('1. manifest.json exists in dashboard build output', () => {
    it('should have manifest.json in dist/dashboard/', async () => {
      const { access } = await import('node:fs/promises');
      const manifestPath = join(process.cwd(), 'dist', 'dashboard', 'manifest.json');
      await expect(access(manifestPath)).resolves.toBeUndefined();
    });

    it('should contain required PWA fields', async () => {
      const manifestPath = join(process.cwd(), 'dist', 'dashboard', 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      expect(manifest.name).toBeDefined();
      expect(manifest.short_name).toBeDefined();
      expect(manifest.start_url).toBe('/dashboard');
      expect(manifest.display).toBeDefined();
      expect(manifest.icons).toBeDefined();
      expect(Array.isArray(manifest.icons)).toBe(true);
    });

    it('should reference icon assets with /dashboard/ prefix', async () => {
      const manifestPath = join(process.cwd(), 'dist', 'dashboard', 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      for (const icon of manifest.icons) {
        expect(icon.src).toMatch(/^\/dashboard\//);
      }
    });
  });

  describe('2. Server serves manifest.json at root path', () => {
    it('should register /manifest.json route in server.ts', async () => {
      const serverContent = await readFile(join(process.cwd(), 'src', 'server.ts'), 'utf-8');
      expect(serverContent).toMatch(/registerManifestRoutes/);
    });

    it('should bypass authentication for /manifest.json', async () => {
      const serverContent = await readFile(join(process.cwd(), 'src', 'server.ts'), 'utf-8');
      // The auth bypass for manifest.json should be present
      expect(serverContent).toMatch(/manifest\.json.*return/);
    });

    it('should import registerManifestRoutes from routes/index.ts', async () => {
      const routesIndexContent = await readFile(join(process.cwd(), 'src', 'routes', 'index.ts'), 'utf-8');
      expect(routesIndexContent).toMatch(/registerManifestRoutes.*from.*manifest/);
    });
  });

  describe('3. manifest route module exists', () => {
    it('should export registerManifestRoutes function', async () => {
      const manifestRouteContent = await readFile(join(process.cwd(), 'src', 'routes', 'manifest.ts'), 'utf-8');
      expect(manifestRouteContent).toMatch(/export function registerManifestRoutes/);
    });

    it('should serve manifest with correct Content-Type header', async () => {
      const manifestRouteContent = await readFile(join(process.cwd(), 'src', 'routes', 'manifest.ts'), 'utf-8');
      expect(manifestRouteContent).toMatch(/application\/json/);
    });
  });
});
