#!/usr/bin/env node
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join("dashboard", "dist");
const dst = join("dist", "dashboard");

if (existsSync(src)) {
  cpSync(src, dst, { recursive: true });
  console.log("Dashboard copied to dist/dashboard/");
} else if (process.env.CI || process.env.npm_config_publish) {
  console.error("Error: dashboard/dist/ not found in publish/CI context. Build the dashboard first.");
  process.exit(1);
} else {
  console.log("No dashboard/dist/ found — skipping dashboard copy");
}
