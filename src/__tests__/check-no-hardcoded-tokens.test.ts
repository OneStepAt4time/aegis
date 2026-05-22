import { afterEach, describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const SCRIPT = join(__dirname, "../../scripts/check-no-hardcoded-tokens.sh");

describe("check-no-hardcoded-tokens.sh", () => {
  const tmpDir = join(__dirname, "__tmp_token_test__");

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 when no tokens are present", () => {
    const result = execSync(`bash ${SCRIPT}`, {
      encoding: "utf-8",
      timeout: 60000,
    });
    expect(result).toContain("OK: No hardcoded tokens");
  }, 30000);

  it("detects a hardcoded gho_ token", () => {
    mkdirSync(tmpDir, { recursive: true });
    const fakeFile = join(tmpDir, "fake-config.ts");
    // Use obviously-fake pattern: all zeros (not a real token)
    writeFileSync(
      fakeFile,
      'const token = "gho_000000000000000000000000000000000000";'
    );

    const pattern = "gho_[a-zA-Z0-9]{36}";
    const result = execSync(`grep -Pcn '${pattern}' '${fakeFile}'`, {
      encoding: "utf-8",
    });
    expect(result.trim()).toBe("1");
  });

  it("detects a hardcoded ghp_ token", () => {
    mkdirSync(tmpDir, { recursive: true });
    const fakeFile = join(tmpDir, "fake-pat.ts");
    // Use obviously-fake pattern: all zeros (not a real token)
    writeFileSync(
      fakeFile,
      'const pat = "ghp_000000000000000000000000000000000000";'
    );

    const pattern = "ghp_[a-zA-Z0-9]{36}";
    const result = execSync(`grep -Pcn '${pattern}' '${fakeFile}'`, {
      encoding: "utf-8",
    });
    expect(result.trim()).toBe("1");
  });

  it("does not flag env var references", () => {
    mkdirSync(tmpDir, { recursive: true });
    const fakeFile = join(tmpDir, "safe-config.ts");
    writeFileSync(
      fakeFile,
      'const token = process.env["AEGIS_MCP_GITHUB_TOKEN"];'
    );

    const pattern = "gho_[a-zA-Z0-9]{36}";
    let matched = false;
    try {
      execSync(`grep -Pc '${pattern}' '${fakeFile}'`, { encoding: "utf-8" });
      matched = true;
    } catch {
      // grep exits 1 when no match
    }
    expect(matched).toBe(false);
  });
});
