#!/usr/bin/env node
/**
 * copy-dashboard.mjs — Copy dashboard build output into dist/dashboard/
 *
 * Called by `npm run build:copy-dashboard` (part of the main build).
 * Validates that the copy succeeds and index.html is present.
 *
 * Issue #1699 / ARC-6: Added post-copy validation and proper error handling.
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join("dashboard", "dist");
const dst = join("dist", "dashboard");

if (existsSync(src)) {
  cpSync(src, dst, { recursive: true });

  // Post-copy validation: ensure index.html was copied
  const indexPath = join(dst, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`Error: dashboard copy succeeded but ${indexPath} not found. Dashboard build may be incomplete.`);
    process.exit(1);
  }

  console.log("Dashboard copied to dist/dashboard/ ✓");
} else if (process.env.npm_lifecycle_event === 'prepublishOnly') {
  // During npm publish, missing dashboard is a hard error
  console.error("Error: dashboard/dist/ not found. Run 'npm run build:dashboard' first.");
  process.exit(1);
} else if (process.env.CI === 'true') {
  // In CI we never want a successful build artifact without dashboard assets.
  console.error("Error: dashboard/dist/ not found in CI. Refusing to produce a package without dashboard assets.");
  process.exit(1);
} else {
  console.log("No dashboard/dist/ found — skipping dashboard copy (dev mode)");
}
