import { execFile } from 'node:child_process';
import { promisify } from 'util';
import { join } from 'path';
import { statSync } from 'fs';
import type { VerificationResult } from './events.js';

const execFileAsync = promisify(execFile);

interface RunOptions {
  cwd: string;
  timeoutMs: number;
}

async function runCmd(file: string, args: string[], { cwd, timeoutMs }: RunOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd, timeout: Math.floor(timeoutMs / 1000), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    return { stdout, stderr, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exitCode: err.code ?? 1 };
  }
}

export async function runVerification(workDir: string, criticalOnly = false): Promise<VerificationResult> {
  const start = Date.now();

  const packageJsonPath = join(workDir, 'package.json');
  let hasPackageJson = false;
  try {
    hasPackageJson = statSync(packageJsonPath).isFile();
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code !== 'ENOENT') throw e;
  }

  if (!hasPackageJson) {
    return {
      ok: false,
      steps: [],
      totalDurationMs: Date.now() - start,
      summary: 'No package.json found — cannot verify',
    };
  }

  const steps: {
    name: "tsc" | "build" | "test";
    ok: boolean;
    durationMs: number;
    output?: string;
    error?: string;
  }[] = [];
  const timeoutMs = 120_000;

  // Step 1: tsc
  const tscStart = Date.now();
  const tscResult = await runCmd('npx', ['tsc', '--noEmit'], { cwd: workDir, timeoutMs });
  const tscDuration = Date.now() - tscStart;
  const tscOk = tscResult.exitCode === 0;
  steps.push({
    name: 'tsc',
    ok: tscOk,
    durationMs: tscDuration,
    output: tscResult.stdout.slice(0, 2000),
    error: tscOk ? undefined : (tscResult.stderr || tscResult.stdout).slice(0, 2000),
  });

  // Step 2: build
  const buildStart = Date.now();
  const buildResult = await runCmd('npm', ['run', 'build'], { cwd: workDir, timeoutMs });
  const buildDuration = Date.now() - buildStart;
  const buildOk = buildResult.exitCode === 0;
  steps.push({
    name: 'build',
    ok: buildOk,
    durationMs: buildDuration,
    output: buildResult.stdout.slice(0, 2000),
    error: buildOk ? undefined : (buildResult.stderr || buildResult.stdout).slice(0, 2000),
  });

  // Step 3: test (unless criticalOnly)
  let testOk = true;
  if (!criticalOnly) {
    const testStart = Date.now();
    const testResult = await runCmd('npm', ['test'], { cwd: workDir, timeoutMs: 180_000 });
    const testDuration = Date.now() - testStart;
    testOk = testResult.exitCode === 0;
    steps.push({ name: 'test' as const, ok: testOk, durationMs: testDuration, output: testResult.stdout.slice(0, 2000), error: testOk ? undefined : (testResult.stderr || testResult.stdout).slice(0, 2000) });
  }

  const ok = tscOk && buildOk && (!criticalOnly || testOk);
  const totalDurationMs = Date.now() - start;
  const summary = ok
    ? `Verification passed: tsc ✅, build ✅${criticalOnly ? '' : ', test ✅'} (${totalDurationMs}ms)`
    : `Verification failed: ${[
        !tscOk ? 'tsc ❌' : '',
        !buildOk ? 'build ❌' : '',
        !criticalOnly && !testOk ? 'test ❌' : '',
      ].filter(Boolean).join(', ')} (${totalDurationMs}ms)`;

  return { ok, steps, totalDurationMs, summary };
}
