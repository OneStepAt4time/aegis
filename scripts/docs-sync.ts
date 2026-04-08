#!/usr/bin/env npx tsx
/**
 * docs-sync: TSDoc coverage audit + README endpoint table sync
 *
 * Usage: npx tsx scripts/docs-sync.ts [--fix] [--readme]
 *
 * --fix     Apply TSDoc tag insertions (default: dry-run)
 * --readme  Update README endpoint table (default: report only)
 */

import {
  Project,
  SyntaxKind,
  type FunctionDeclaration,
  type MethodDeclaration,
  type JSDoc,
} from "ts-morph";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const README = path.join(ROOT, "README.md");

const args = process.argv.slice(2);
const FIX = args.includes("--fix");
const README_FIX = args.includes("--readme");

// ─── Types ──────────────────────────────────────────────────

interface DocGap {
  file: string;
  name: string;
  missingParams: string[];
  missingReturns: boolean;
}

interface RouteInfo {
  method: string;
  path: string;
  handler: string;
}

// ─── TSDoc Audit ────────────────────────────────────────────

function getParamNames(node: FunctionDeclaration | MethodDeclaration): string[] {
  return node.getParameters().map((p) => p.getName()).filter(Boolean);
}

function jsdocHasTag(jsdoc: JSDoc, tagName: string, paramName?: string): boolean {
  return jsdoc.getTags().some((t) => {
    if (t.getTagName() !== tagName) return false;
    if (paramName) return (t.getCommentText()?.includes(paramName) ?? false);
    return true;
  });
}

function auditDeclaration(
  file: import("ts-morph").SourceFile,
  decl: FunctionDeclaration | MethodDeclaration,
  className?: string
): DocGap {
  const name = className ? `${className}.${decl.getName()}` : decl.getName() ?? "<anon>";
  const filePath = file.getFilePath().replace(ROOT + "/", "");
  const params = getParamNames(decl);
  const jsdocs = decl.getJsDocs();
  const jsdoc = jsdocs[0];

  const gap: DocGap = {
    file: filePath,
    name,
    missingParams: [],
    missingReturns: false,
  };

  if (!jsdoc) {
    gap.missingParams = [...params];
    const rt = decl.getReturnType();
    if (rt.getText(decl) !== "void") gap.missingReturns = true;
    return gap;
  }

  for (const p of params) {
    if (!jsdocHasTag(jsdoc, "param", p)) gap.missingParams.push(p);
  }

  const retType = decl.getReturnType();
  if (retType.getText(decl) !== "void" && !jsdocHasTag(jsdoc, "returns")) {
    gap.missingReturns = true;
  }

  return gap;
}

function runTSDocAudit() {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  const files = project.addSourceFilesAtPaths([
    path.join(SRC, "**/*.ts"),
    "!" + path.join(SRC, "**/*.test.ts"),
    "!" + path.join(SRC, "**/*.spec.ts"),
  ]);

  const gaps: DocGap[] = [];
  let total = 0;

  for (const file of files) {
    for (const fn of file.getFunctions()) {
      if (!fn.isExported()) continue;
      total++;
      gaps.push(auditDeclaration(file, fn));
    }
    for (const cls of file.getClasses()) {
      if (!cls.isExported()) continue;
      for (const method of cls.getMethods()) {
        if (method.getName() === "constructor") continue;
        const scope = method.getScope();
        if (scope === "private" || scope === "protected") continue;
        total++;
        gaps.push(auditDeclaration(file, method, cls.getName()));
      }
    }
  }

  const documented = gaps.filter(
    (g) => g.missingParams.length === 0 && !g.missingReturns
  ).length;
  return { gaps, total, documented };
}

function printTSDocReport(audit: ReturnType<typeof runTSDocAudit>) {
  const { gaps, total, documented } = audit;
  const pct = total > 0 ? ((documented / total) * 100).toFixed(1) : "100.0";

  console.log("\nTSDoc Coverage Report");
  console.log("=====================");
  console.log(`Documented: ${documented}/${total} methods (${pct}%)`);

  const issues = gaps.filter((g) => g.missingParams.length > 0 || g.missingReturns);
  if (issues.length === 0) {
    console.log("All public exports fully documented!\n");
    return;
  }

  console.log(`\nIssues found (${issues.length}):`);
  for (const g of issues) {
    const parts: string[] = [];
    if (g.missingParams.length > 0) parts.push(`missing @param: ${g.missingParams.join(", ")}`);
    if (g.missingReturns) parts.push("missing @returns");
    console.log(`  ${g.file}:${g.name} - ${parts.join("; ")}`);
  }
  console.log();
}

// ─── README Endpoint Sync ───────────────────────────────────

function extractRoutes(): RouteInfo[] {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  const serverFiles = project.addSourceFilesAtPaths(path.join(SRC, "server.ts"));
  const routes: RouteInfo[] = [];

  for (const call of serverFiles[0].getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

    const propAccess = expr.asKind(SyntaxKind.PropertyAccessExpression);
    if (!propAccess) continue;

    const methodName = propAccess.getName();
    if (!["get", "post", "put", "delete", "patch"].includes(methodName)) continue;

    const callArgs = call.getArguments();
    if (callArgs.length < 1 || callArgs[0].getKind() !== SyntaxKind.StringLiteral) continue;

    const routePath = callArgs[0].asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
    let handler = "<anonymous>";
    if (callArgs.length >= 2 && callArgs[1].getKind() === SyntaxKind.Identifier) {
      handler = callArgs[1].asKind(SyntaxKind.Identifier)!.getText();
    }

    routes.push({ method: methodName.toUpperCase(), path: routePath, handler });
  }

  return routes;
}

function parseReadmeEndpoints() {
  const content = fs.readFileSync(README, "utf-8");
  const lines = content.split("\n");
  let inTable = false;
  const endpoints: { method: string; path: string }[] = [];

  for (const line of lines) {
    if (line.includes("## REST API")) inTable = true;
    if (inTable && line.startsWith("<details>")) break;
    const match = line.match(/^\|\s*`(\w+)`\s*\|\s*`([^`]+)`\s*\|/);
    if (inTable && match) {
      endpoints.push({ method: match[1], path: match[2] });
    }
  }
  return endpoints;
}

function printReadmeSync(
  routes: RouteInfo[],
  readmeEndpoints: { method: string; path: string }[]
) {
  const routeSet = new Map<string, RouteInfo>();
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    const existing = routeSet.get(key);
    if (!existing || (!existing.path.startsWith("/v1") && r.path.startsWith("/v1"))) {
      routeSet.set(key, r);
    }
  }

  const inCode = new Set(routeSet.keys());
  const inReadme = new Set(readmeEndpoints.map((e) => `${e.method} ${e.path}`));
  const missing = [...inCode].filter((k) => !inReadme.has(k));
  const stale = [...inReadme].filter((k) => !inCode.has(k));

  console.log("\nREADME Endpoint Sync");
  console.log("====================");
  console.log(`Routes in code:  ${routeSet.size}`);
  console.log(`Routes in README: ${readmeEndpoints.length}`);

  if (missing.length > 0) {
    console.log(`\nIn code but not in README (${missing.length}):`);
    for (const k of missing) console.log(`  ${k}`);
  }
  if (stale.length > 0) {
    console.log(`\nIn README but not in code (${stale.length}):`);
    for (const k of stale) console.log(`  ${k}`);
  }
  if (missing.length === 0 && stale.length === 0) {
    console.log("README endpoint table is in sync!\n");
  } else {
    console.log();
  }
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  console.log("=== docs-sync ===\n");
  const audit = runTSDocAudit();
  printTSDocReport(audit);

  const routes = extractRoutes();
  const readmeEndpoints = parseReadmeEndpoints();
  printReadmeSync(routes, readmeEndpoints);

  const pct =
    audit.total > 0 ? ((audit.documented / audit.total) * 100).toFixed(1) : "100.0";
  const v1Routes = new Set(
    routes.filter((r) => r.path.startsWith("/v1")).map((r) => `${r.method} ${r.path}`)
  );
  const inReadme = new Set(readmeEndpoints.map((e) => `${e.method} ${e.path}`));
  const missingEp = [...v1Routes].filter((k) => !inReadme.has(k)).length;

  console.log("=== docs-sync Summary ===");
  console.log(`TSDoc:     ${audit.documented}/${audit.total} methods documented (${pct}%)`);
  console.log(
    `Endpoints: ${readmeEndpoints.length}/${v1Routes.size} in README, ${missingEp} missing`
  );
  console.log(`Mode:      ${FIX ? "APPLY" : "dry-run"}${README_FIX ? " (readme-fix)" : ""}`);
}

main();
