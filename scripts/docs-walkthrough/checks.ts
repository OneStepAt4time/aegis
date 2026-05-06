/**
 * Automated checks for Aegis documentation markdown files.
 *
 * Each check receives the file's absolute path, its content, and the docs
 * directory root.  It returns an array of findings — an empty array means pass.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { execSync } from "node:child_process";

// ── Types ────────────────────────────────────────────────────────────

export interface Finding {
  line: number;
  column: number;
  message: string;
}

export interface CheckResult {
  check: string;
  status: "pass" | "fail";
  findings: Finding[];
}

export type CheckFn = (params: {
  filePath: string;
  content: string;
  docsDir: string;
  lines: string[];
}) => CheckResult;

// ── 1. Dead Links ───────────────────────────────────────────────────

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

export const deadLinks: CheckFn = ({ filePath, content, docsDir }) => {
  const findings: Finding[] = [];
  const fileDir = dirname(filePath);

  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    const raw = match[2] as string;
    const startIdx = match.index as number;
    const line = content.slice(0, startIdx).split("\n").length;

    // Skip external URLs, anchors-only, and section headings
    if (
      raw.startsWith("http://") ||
      raw.startsWith("https://") ||
      raw.startsWith("#") ||
      raw.startsWith("mailto:")
    ) {
      continue;
    }

    // Strip trailing anchor (#section)
    const pathPart = raw.replace(/#.*$/, "");

    // Resolve relative to the markdown file's directory
    const resolved = resolve(fileDir, pathPart);

    if (!existsSync(resolved)) {
      findings.push({
        line,
        column: 0,
        message: `Dead link: [${match[1]}](${raw}) → ${resolved} does not exist`,
      });
    }
  }

  return {
    check: "dead-links",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
};

// ── 2. Stale References ─────────────────────────────────────────────

const STALE_TERMS = [
  "psmux",
  "windowId",
  "windowName",
  "paneCommand",
  "capture-pane",
];

// Contexts where stale terms are acceptable (historical / migration docs)
const HISTORICAL_KEYWORDS = [
  "no longer",
  "deprecated",
  "legacy",
  "removed",
  "replaced by",
  "pre-ACP",
  "before ACP",
  "pre-ACP-cutover",
  "migration",
  "was replaced",
  "no longer required",
];

export const staleReferences: CheckFn = ({ content, lines }) => {
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Skip code fences (lines inside ``` blocks)
    // We check this loosely — if the line contains a stale term inside a
    // code block that's showing "how things used to be", it may still be
    // intentional.  But we flag it unless it's clearly historical prose.
    for (const term of STALE_TERMS) {
      const idx = line.toLowerCase().indexOf(term.toLowerCase());
      if (idx === -1) continue;

      // Check if the surrounding context (same line) has a historical keyword
      const lineLower = line.toLowerCase();
      const hasHistoricalContext = HISTORICAL_KEYWORDS.some((kw) =>
        lineLower.includes(kw)
      );

      // Also check previous and next line for context
      const prevLine = (lines[i - 1] || "").toLowerCase();
      const nextLine = (lines[i + 1] || "").toLowerCase();
      const nearbyHistorical = [...HISTORICAL_KEYWORDS].some(
        (kw) => prevLine.includes(kw) || nextLine.includes(kw)
      );

      if (!hasHistoricalContext && !nearbyHistorical) {
        findings.push({
          line: i + 1,
          column: idx,
          message: `Stale reference: "${term}" found without historical context`,
        });
      }
    }
  }

  return {
    check: "stale-references",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
};

// ── 3. Code Block Validation ────────────────────────────────────────

const FENCED_CODE_RE = /```(bash|shell)\n([\s\S]*?)```/g;

export const codeBlockValidation: CheckFn = ({ content }) => {
  const findings: Finding[] = [];

  for (const match of content.matchAll(FENCED_CODE_RE)) {
    const lang = match[1] as string;
    const code = match[2] as string;
    const startIdx = match.index as number;
    const startLine = content.slice(0, startIdx).split("\n").length;

    // Validate with bash -n (syntax check, no execution)
    try {
      execSync(`bash -n -c ${JSON.stringify(code)}`, {
        timeout: 5000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      const stderr = (err as { stderr?: Buffer })?.stderr
        ?.toString()
        .trim();
      findings.push({
        line: startLine + 1,
        column: 0,
        message: `Invalid ${lang} syntax in code block: ${stderr || "syntax error"}`,
      });
    }
  }

  return {
    check: "code-block-validation",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
};

// ── 4. Broken Images ────────────────────────────────────────────────

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export const brokenImages: CheckFn = ({ filePath, content, docsDir }) => {
  const findings: Finding[] = [];
  const fileDir = dirname(filePath);

  for (const match of content.matchAll(IMAGE_RE)) {
    const raw = match[2] as string;
    const startIdx = match.index as number;
    const line = content.slice(0, startIdx).split("\n").length;

    // Skip external URLs
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      continue;
    }

    const resolved = resolve(fileDir, raw);

    if (!existsSync(resolved)) {
      findings.push({
        line,
        column: 0,
        message: `Broken image: [${match[1]}](${raw}) → ${resolved} does not exist`,
      });
    }
  }

  return {
    check: "broken-images",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
};

// ── 5. Heading Hierarchy ────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+/;

export const headingHierarchy: CheckFn = ({ lines }) => {
  const findings: Finding[] = [];
  let lastLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]!.match(HEADING_RE);
    if (!match) continue;

    const level = match[1]!.length;

    // H1 is allowed at the top of a file (first heading)
    if (i === 0 && level === 1) {
      lastLevel = level;
      continue;
    }

    // A heading should not skip levels (e.g., h1 → h3)
    if (level > lastLevel + 1 && lastLevel > 0) {
      findings.push({
        line: i + 1,
        column: 0,
        message: `Heading hierarchy: h${level} follows h${lastLevel} (skipped level)`,
      });
    }

    lastLevel = level;
  }

  return {
    check: "heading-hierarchy",
    status: findings.length === 0 ? "pass" : "fail",
    findings,
  };
};

// ── Registry ─────────────────────────────────────────────────────────

export const ALL_CHECKS: { name: string; fn: CheckFn }[] = [
  { name: "Dead Links", fn: deadLinks },
  { name: "Stale References", fn: staleReferences },
  { name: "Code Block Validation", fn: codeBlockValidation },
  { name: "Broken Images", fn: brokenImages },
  { name: "Heading Hierarchy", fn: headingHierarchy },
];
