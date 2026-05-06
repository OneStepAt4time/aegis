#!/usr/bin/env tsx
/**
 * Aegis Docs Walk-Through Runner
 *
 * Walks through all configured doc pages and runs automated checks.
 * Usage:
 *   npm test                  # human-readable table
 *   npm run test:json         # machine-readable JSON
 *   npm run test:verbose      # verbose output with all findings
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { ALL_CHECKS, type CheckResult } from "./checks.js";

// ── Configuration ───────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const DOCS_DIR = join(REPO_ROOT, "docs");

const PAGES: { name: string; file: string }[] = [
  { name: "Getting Started", file: "getting-started.md" },
  { name: "ACP Migration Guide", file: "acp-migration-guide.md" },
  { name: "API Reference", file: "api-reference.md" },
  { name: "MCP Tools", file: "mcp-tools.md" },
  { name: "Deployment Guide", file: "deployment.md" },
  { name: "Windows Setup", file: "windows-setup.md" },
  { name: "Troubleshooting", file: "troubleshooting.md" },
  { name: "BYO LLM", file: "byo-llm.md" },
];

// ── Types ────────────────────────────────────────────────────────────

interface PageResult {
  page: string;
  file: string;
  skipped: boolean;
  checks: CheckResult[];
}

// ── Runner ──────────────────────────────────────────────────────────

function runWalkthrough(): PageResult[] {
  const results: PageResult[] = [];

  for (const page of PAGES) {
    const filePath = join(DOCS_DIR, page.file);

    if (!existsSync(filePath)) {
      console.log(`⏭️  ${page.name}: skipped (file not found)`);
      results.push({
        page: page.name,
        file: page.file,
        skipped: true,
        checks: [],
      });
      continue;
    }

    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const checks: CheckResult[] = [];

    for (const { name, fn } of ALL_CHECKS) {
      try {
        const result = fn({ filePath, content, docsDir: DOCS_DIR, lines });
        checks.push(result);
      } catch (err: unknown) {
        checks.push({
          check: name.toLowerCase().replace(/\s+/g, "-"),
          status: "fail",
          findings: [
            {
              line: 0,
              column: 0,
              message: `Check crashed: ${(err as Error).message}`,
            },
          ],
        });
      }
    }

    results.push({
      page: page.name,
      file: page.file,
      skipped: false,
      checks,
    });
  }

  return results;
}

// ── Formatters ──────────────────────────────────────────────────────

function formatTable(results: PageResult[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("╔════════════════════════════════════════════════════════════════════════════════╗");
  lines.push("║                        AEGIS DOCS WALK-THROUGH REPORT                         ║");
  lines.push("╚════════════════════════════════════════════════════════════════════════════════╝");
  lines.push("");

  let totalChecks = 0;
  let totalFails = 0;
  let totalFindings = 0;

  for (const result of results) {
    if (result.skipped) {
      lines.push(`  ⏭️  ${result.page.padEnd(24)} SKIPPED (file not found)`);
      lines.push("");
      continue;
    }

    lines.push(`  📄 ${result.page}`);
    lines.push(`     ${"─".repeat(50)}`);

    for (const check of result.checks) {
      totalChecks++;
      const icon = check.status === "pass" ? "✅" : "❌";
      const detail =
        check.status === "pass"
          ? ""
          : ` — ${check.findings.length} finding(s)`;
      lines.push(
        `     ${icon} ${check.check.padEnd(26)} ${check.status.toUpperCase()}${detail}`
      );

      if (check.status === "fail") {
        totalFails++;
        totalFindings += check.findings.length;
      }
    }

    lines.push("");
  }

  // Summary
  lines.push("  ──────────────────────────────────────────────────────");
  const summaryIcon = totalFails === 0 ? "✅" : "❌";
  lines.push(
    `  ${summaryIcon} Summary: ${totalChecks} checks, ${totalFails} failed, ${totalFindings} total findings`
  );
  lines.push("");

  return lines.join("\n");
}

function formatJson(results: PageResult[]): string {
  const output = {
    timestamp: new Date().toISOString(),
    pages: results.map((r) => ({
      page: r.page,
      file: r.file,
      skipped: r.skipped,
      checks: r.checks.map((c) => ({
        check: c.check,
        status: c.status,
        findingCount: c.findings.length,
        findings: c.findings.map((f) => ({
          line: f.line,
          column: f.column,
          message: f.message,
        })),
      })),
    })),
    summary: {
      totalChecks: results.reduce((n, r) => n + r.checks.length, 0),
      failedChecks: results.reduce(
        (n, r) => n + r.checks.filter((c) => c.status === "fail").length,
        0
      ),
      totalFindings: results.reduce(
        (n, r) => n + r.checks.reduce((n2, c) => n2 + c.findings.length, 0),
        0
      ),
    },
  };
  return JSON.stringify(output, null, 2);
}

function formatVerbose(results: PageResult[]): string {
  const lines: string[] = [];
  lines.push(formatTable(results));

  for (const result of results) {
    if (result.skipped) continue;

    const failedChecks = result.checks.filter((c) => c.status === "fail");
    if (failedChecks.length === 0) continue;

    lines.push(`  📄 ${result.page} — ${result.file}`);
    lines.push("");

    for (const check of failedChecks) {
      lines.push(`     ❌ ${check.check}:`);
      for (const f of check.findings) {
        lines.push(`        L${f.line}:${f.column}  ${f.message}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const verboseMode = args.includes("--verbose");

console.error(`Docs dir: ${DOCS_DIR}`);

const results = runWalkthrough();

if (jsonMode) {
  console.log(formatJson(results));
} else {
  console.log(verboseMode ? formatVerbose(results) : formatTable(results));
}

// Exit code: 0 if all clean, 1 if any issues
const hasFailures = results.some((r) =>
  r.checks.some((c) => c.status === "fail")
);
process.exit(hasFailures ? 1 : 0);
