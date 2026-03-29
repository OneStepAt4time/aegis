#!/usr/bin/env node
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join("dashboard", "dist");
const dst = join("dist", "dashboard");

if (existsSync(src)) {
  cpSync(src, dst, { recursive: true });
  console.log("Dashboard copied to dist/dashboard/");
} else {
  console.log("No dashboard/dist/ found — skipping dashboard copy");
}
