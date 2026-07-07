#!/usr/bin/env node
/**
 * scripts/gate-safe.mjs — run `npm run gate` with memory + CPU caps.
 *
 * The full gate pins CPU/RAM for several minutes (686-file serial vitest,
 * tsc, vite dashboard build). On a single dev machine that freezes the OS.
 * This wrapper runs the SAME gate — nothing is skipped — but bounds the
 * resources so the machine stays responsive:
 *
 *   - NODE_OPTIONS=--max-old-space-size=<MB>   caps the V8 heap of every
 *     node process in the tree (tsc, vite, each vitest worker). Propagates
 *     via env, so grandchildren inherit it.
 *   - os.setPriority(BELOW_NORMAL)              drops our own scheduling
 *     priority; the npm child and its node grandchildren inherit it, so the
 *     OS hands CPU to your editor/terminal first.
 *
 * The suite still runs end-to-end and still fails the gate on real errors.
 *
 * Usage:
 *   npm run gate:safe            # 2 GB heap cap, below-normal priority
 *   npm run gate:safe -- 3072    # 3 GB heap cap
 *   npm run gate:safe -- --dry   # print resolved env, do not run
 */
import { spawn } from 'node:child_process';
import os from 'node:os';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const memArg = args.find((a) => /^\d+$/.test(a));
const memMb = memArg ? Number(memArg) : 2048;

const heapFlag = `--max-old-space-size=${memMb}`;
const baseNodeOptions = process.env.NODE_OPTIONS?.trim();
const nodeOptions = baseNodeOptions ? `${baseNodeOptions} ${heapFlag}` : heapFlag;
const env = { ...process.env, NODE_OPTIONS: nodeOptions };

if (dry) {
  console.log('[gate:safe] dry-run — would run `npm run gate` with:');
  console.log(`  NODE_OPTIONS = ${nodeOptions}`);
  console.log(`  priority     = BELOW_NORMAL (${os.constants.priority.PRIORITY_BELOW_NORMAL})`);
  process.exit(0);
}

// Drop our own priority before spawning so the npm child (and every node
// grandchild: tsc, vite, vitest workers) inherits it. Best-effort — on some
// platforms non-privileged users cannot raise priority back, and a few
// platforms no-op the call; the heap cap is the load-bearing safety net.
try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  /* best-effort; memory cap alone keeps the machine responsive */
}

const child = spawn('npm', ['run', 'gate'], { stdio: 'inherit', shell: true, env });
child.on('exit', (code) => process.exit(code ?? 0));
