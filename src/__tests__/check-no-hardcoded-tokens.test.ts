import { afterEach, describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SCRIPT = join(__dirname, "../../scripts/check-no-hardcoded-tokens.cjs");

describe("check-no-hardcoded-tokens.cjs", () => {
  let tmpDir: string | undefined;

  function createRepo(files: Record<string, string>): string {
    const repo = mkdtempSync(join(tmpdir(), "aegis-token-test-"));
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });

    for (const [file, content] of Object.entries(files)) {
      const filePath = join(repo, file);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }

    execFileSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
    tmpDir = repo;
    return repo;
  }

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("exits 0 when no tokens are present", () => {
    const repo = createRepo({
      "src/config.ts": 'const token = process.env["AEGIS_MCP_GITHUB_TOKEN"];',
    });
    const result = execFileSync("node", [SCRIPT], {
      cwd: repo,
      encoding: "utf-8",
      timeout: 60000,
    });
    expect(result).toContain("OK: No hardcoded tokens");
  }, 30000);

  it("detects a hardcoded gho_ token", () => {
    const repo = createRepo({
      "src/fake-config.ts": 'const token = "gho_000000000000000000000000000000000000";',
    });
    const result = spawnSync("node", [SCRIPT], {
      cwd: repo,
      encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Hardcoded token pattern 'gho_[a-zA-Z0-9]{36}'");
  });

  it("detects a hardcoded ghp_ token", () => {
    const repo = createRepo({
      "src/fake-pat.ts": 'const pat = "ghp_000000000000000000000000000000000000";',
    });
    const result = spawnSync("node", [SCRIPT], {
      cwd: repo,
      encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Hardcoded token pattern 'ghp_[a-zA-Z0-9]{36}'");
  });

  it("does not flag env var references", () => {
    const repo = createRepo({
      "src/safe-config.ts": 'const token = process.env["AEGIS_MCP_GITHUB_TOKEN"];',
    });
    const result = execFileSync("node", [SCRIPT], {
      cwd: repo,
      encoding: "utf-8",
    });
    expect(result).toContain("OK: No hardcoded tokens");
  });
});
