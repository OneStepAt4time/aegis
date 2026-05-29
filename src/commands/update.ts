/**
 * commands/update.ts — `ag update` — Check for and apply self-updates.
 *
 * Detects install method (npm global vs direct binary) and either runs
 * `npm update -g` or downloads from GitHub releases with SHA-256 verification.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read the current package version from the nearest package.json. */
function getCurrentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Semver comparison (lightweight — avoids adding a runtime dependency)
// ---------------------------------------------------------------------------

/** Parse a semver string (with optional "v" prefix) into [major, minor, patch]. */
function parseSemver(v: string): [number, number, number] | null {
  const s = v.trim().replace(/^v/, '');
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

/** Returns true when `latest` is strictly newer than `current`. */
function isNewer(latest: string, current: string): boolean {
  const l = parseSemver(latest);
  const c = parseSemver(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i];
  }
  return false;
}

// ---------------------------------------------------------------------------
// GitHub releases API
// ---------------------------------------------------------------------------

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

/** Fetch the latest GitHub release metadata. */
async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = 'https://api.github.com/repos/OneStepAt4time/aegis/releases/latest';
  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'aegis-cli' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}`);
  }

  return (await res.json()) as GitHubRelease;
}

// ---------------------------------------------------------------------------
// Install-method detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the running binary was installed via npm (globally).
 *
 * Returns true when the resolved binary path sits inside a node_modules tree
 * or a known npm global bin directory.
 */
function isNpmInstall(): boolean {
  try {
    // process.execPath is the node binary; process.argv[1] is the script.
    // For a globally-installed CLI, the script lives under node_modules.
    const scriptPath = process.argv[1] ?? '';

    // Typical npm global layout: <prefix>/lib/node_modules/@scope/pkg/dist/cli.js
    // Binary symlink: <prefix>/bin/ag -> ../lib/node_modules/@scope/pkg/dist/cli.js
    const npmIndicators = ['node_modules', join('npm', 'global'), join('npm', 'npx')];

    for (const indicator of npmIndicators) {
      if (scriptPath.includes(indicator)) return true;
    }

    // Check if the binary directory matches npm global bin
    // npm root -g typically ends with node_modules
    try {
      const npmGlobalPrefix = execFileSync('npm', ['prefix', '-g'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (scriptPath.startsWith(join(npmGlobalPrefix, 'lib', 'node_modules'))) return true;
      if (scriptPath.startsWith(join(npmGlobalPrefix, 'node_modules'))) return true;
    } catch {
      // npm not available — assume non-npm install
    }

    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// npm update
// ---------------------------------------------------------------------------

async function updateViaNpm(): Promise<void> {
  execFileSync('npm', ['update', '-g', '@onestepat4time/aegis'], {
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: 'pipe',
  });
}

// ---------------------------------------------------------------------------
// Direct download with SHA-256 verification
// ---------------------------------------------------------------------------

function platformAssetName(): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'amd64' : process.arch;
  return `aegis-cli-${platform}-${arch}.tar.gz`;
}

async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'aegis-cli' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** Compute the SHA-256 hex digest of a buffer. */
function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Find the checksums.txt asset and return the expected SHA-256 for the given asset name. */
async function resolveExpectedChecksum(
  assets: GitHubReleaseAsset[],
  assetName: string,
): Promise<string> {
  // Look for a checksums.txt asset
  const checksumAsset = assets.find(a => a.name === 'checksums.txt');
  if (!checksumAsset) {
    throw new Error(
      'checksums.txt not found in release assets — cannot verify download integrity. ' +
      'Aborting for safety. Use npm to update instead: npm install -g @onestepat4time/aegis',
    );
  }

  const manifest = (await downloadBytes(checksumAsset.browser_download_url)).toString('utf-8');
  for (const line of manifest.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const fields = trimmed.split(/\s+/);
    if (fields.length >= 2 && fields[1] === assetName) {
      return fields[0]!.toLowerCase();
    }
  }

  throw new Error(`No checksum entry for "${assetName}" in checksums.txt — aborting for safety.`);
}

export interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

// ---------------------------------------------------------------------------
// writeLine helper (same signature as other commands)
// ---------------------------------------------------------------------------

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}


// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

async function confirmUpdate(io: CliIO, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    writeLine(io.stdout, '');
    writeLine(io.stdout, `  ${message}`);
    writeLine(io.stdout, '  Update now? [y/N] ');
    const onData = (chunk: Buffer) => {
      io.stdin.removeListener('data', onData);
      const answer = chunk.toString().trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    };
    io.stdin.once('data', onData);

    // Timeout after 15 seconds — default to "no"
    setTimeout(() => {
      io.stdin.removeListener('data', onData);
      resolve(false);
    }, 15_000);
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleUpdate(argv: string[], io: CliIO): Promise<number> {
  const checkOnly = argv.includes('--check');
  const dryRun = argv.includes('--dry-run');
  const skipConfirm = argv.includes('--yes') || argv.includes('-y');

  const currentVersion = getCurrentVersion();

  // --- Fetch latest release ---
  let release: GitHubRelease;
  try {
    writeLine(io.stdout);
    release = await fetchLatestRelease();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    writeLine(io.stderr, `  ❌ Failed to check for updates: ${msg}`);
    writeLine(io.stderr, '     Check your network connection and try again.');
    return 1;
  }

  const latestTag = release.tag_name;
  const latestVersion = latestTag.replace(/^v/, '');

  // --- Display version info ---
  writeLine(io.stdout, `  Current: v${currentVersion}`);
  writeLine(io.stdout, `  Latest:  v${latestVersion}`);

  if (!isNewer(latestTag, currentVersion)) {
    writeLine(io.stdout);
    writeLine(io.stdout, '  ✅ Already up-to-date.');
    return 0;
  }

  // --- Check-only mode ---
  if (checkOnly) {
    writeLine(io.stdout);
    writeLine(io.stdout, '  Update available!');
    return 1;
  }

  // --- Determine update method ---
  const npmDetected = isNpmInstall();
  const updateMethod = npmDetected ? 'npm' : 'download';

  writeLine(io.stdout);
  writeLine(io.stdout, `  Update available! (${npmDetected ? 'npm global install detected' : 'direct binary install detected'})`);

  // --- Dry-run mode ---
  if (dryRun) {
    writeLine(io.stdout);
    writeLine(io.stdout, '  (dry-run — no changes made)');
    return 1;
  }

  // --- Confirm ---
  if (!skipConfirm) {
    const confirmed = await confirmUpdate(io, `Update ag from v${currentVersion} to v${latestVersion}?`);
    if (!confirmed) {
      writeLine(io.stdout, '  Update cancelled.');
      return 0;
    }
  }

  // --- Execute update ---
  try {
    if (updateMethod === 'npm') {
      writeLine(io.stdout, `  Running: npm update -g @onestepat4time/aegis ...`);
      await updateViaNpm();
      writeLine(io.stdout, `  Updated to v${latestVersion} ✅`);
    } else {
      writeLine(io.stdout, `  Downloading from GitHub releases ...`);
      const assetName = platformAssetName();
      const asset = release.assets.find(a => a.name === assetName);
      if (!asset) {
        writeLine(io.stderr, `  ❌ No release asset found for your platform (${assetName}).`);
        writeLine(io.stderr, '     Available assets:');
        for (const a of release.assets.slice(0, 10)) {
          writeLine(io.stderr, `       - ${a.name}`);
        }
        writeLine(io.stderr, '     Try updating via npm: npm install -g @onestepat4time/aegis');
        return 1;
      }

      // Fetch checksums first
      const expectedSha = await resolveExpectedChecksum(release.assets, assetName);

      // Download archive
      const archiveData = await downloadBytes(asset.browser_download_url);

      // Verify SHA-256
      const actualSha = sha256Hex(archiveData);
      if (actualSha !== expectedSha) {
        writeLine(io.stderr, `  ❌ SHA-256 checksum mismatch!`);
        writeLine(io.stderr, `     Expected: ${expectedSha}`);
        writeLine(io.stderr, `     Actual:   ${actualSha}`);
        writeLine(io.stderr, '     Download NOT applied. This may indicate a corrupted or tampered file.');
        return 1;
      }

      // Resolve the actual CLI script path (not process.execPath which is the
      // Node binary). For npm installs this is the JS entry point; for standalone
      // builds it may be the compiled binary.
      const cliScriptPath = process.argv[1] ?? process.execPath;

      // Write archive to temp, extract, and replace


      const tmpDir = mkdtempSync(join(tmpdir(), 'aegis-update-'));
      const archivePath = join(tmpDir, assetName);

      try {
        // Write downloaded archive
        writeFileSync(archivePath, archiveData);

        // Extract
        execFileSync('tar', ['-xzf', archivePath, '-C', tmpDir], { timeout: 30_000 });

        // Find the extracted binary/script — look for 'ag' or 'aegis' or 'dist/' contents
        const extractedFiles = readdirSync(tmpDir).filter(f => f !== assetName);

        // Look for a nested directory structure
        let binarySource: string | null = null;
        const possibleNames = ['ag', 'aegis', 'ag.bin'];
        for (const name of possibleNames) {
          const candidate = join(tmpDir, name);
          if (existsSync(candidate)) {
            binarySource = candidate;
            break;
          }
          // Check inside subdirectory
          for (const dir of extractedFiles) {
            const nestedCandidate = join(tmpDir, dir, name);
            if (existsSync(nestedCandidate)) {
              binarySource = nestedCandidate;
              break;
            }
          }
          if (binarySource) break;
        }

        if (!binarySource) {
          writeLine(io.stderr, '  ❌ Could not locate binary in the downloaded archive.');
          writeLine(io.stderr, `     Archive contents: ${extractedFiles.join(', ')}`);
          return 1;
        }

        // Atomic replace: write to temp file adjacent to target, then rename
        const targetPath = cliScriptPath;
        const tmpTarget = join(dirname(targetPath), `.aegis-update-${Date.now()}`);

        // Preserve permissions
        const originalStat = statSync(targetPath);
        copyFileSync(binarySource, tmpTarget);
        chmodSync(tmpTarget, originalStat.mode);

        // Atomic rename
        renameSync(tmpTarget, targetPath);

        writeLine(io.stdout, `  Updated to v${latestVersion} ✅`);
        writeLine(io.stdout, `  Replaced: ${targetPath}`);
      } finally {
        // Cleanup temp directory
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    if (msg.includes('EACCES') || msg.includes('permission denied') || msg.includes('EPERM')) {
      writeLine(io.stderr, `  ❌ Permission denied while updating.`);
      writeLine(io.stderr, '     Try running with sudo or use npm:');
      writeLine(io.stderr, '       sudo npm install -g @onestepat4time/aegis');
    } else {
      writeLine(io.stderr, `  ❌ Update failed: ${msg}`);
    }
    return 1;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { parseSemver, isNewer, isNpmInstall, getCurrentVersion };
