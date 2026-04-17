import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCli } from '../cli.js';

class CaptureStream extends Writable {
  private chunks: string[] = [];

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

interface TemplateExpectation {
  name: string;
  targetPath: string;
  type: string;
}

const TEMPLATE_EXPECTATIONS: TemplateExpectation[] = [
  { name: 'code-reviewer', targetPath: '.claude/agents/code-reviewer.md', type: 'agent' },
  { name: 'ci-runner', targetPath: '.claude/commands/ci-runner.md', type: 'slash-command' },
  { name: 'pr-reviewer', targetPath: '.claude/commands/pr-reviewer.md', type: 'slash-command' },
  { name: 'docs-writer', targetPath: '.claude/skills/docs-writer/SKILL.md', type: 'skill' },
];

function resolveRelativePath(baseDir: string, relativePath: string): string {
  return join(baseDir, ...relativePath.split('/'));
}

function renderRelativePath(relativePath: string): string {
  return join(...relativePath.split('/'));
}

describe('ag init template gallery', () => {
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let workRoot: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };

    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AEGIS_') || key.startsWith('MANUS_')) {
        delete process.env[key];
      }
    }

    const scratchRoot = join(originalCwd, '.test-scratch');
    mkdirSync(scratchRoot, { recursive: true });
    workRoot = mkdtempSync(join(scratchRoot, 'aegis-cli-template-gallery-'));
    process.chdir(workRoot);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(workRoot, { recursive: true, force: true });
  });

  async function runCommand(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(argv, { stdin, stdout, stderr });
    setImmediate(() => stdin.end());

    const code = await runPromise;
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  }

  it('lists the built-in starter templates', async () => {
    const result = await runCommand(['init', '--list-templates']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    for (const template of TEMPLATE_EXPECTATIONS) {
      expect(result.stdout).toContain(`${template.name} [${template.type}]`);
      expect(result.stdout).toContain(renderRelativePath(template.targetPath));
    }
  });

  it('scaffolds each starter template and validates it with ag doctor', async () => {
    for (const template of TEMPLATE_EXPECTATIONS) {
      const projectDir = mkdtempSync(join(workRoot, `${template.name}-`));
      process.chdir(projectDir);

      try {
        const initResult = await runCommand(['init', '--from-template', template.name]);
        const generatedPath = resolveRelativePath(projectDir, template.targetPath);

        expect(initResult.code).toBe(0);
        expect(initResult.stderr).toBe('');
        expect(existsSync(generatedPath)).toBe(true);
        expect(initResult.stdout).toContain(`Scaffolded ${template.type} template: ${template.name}`);
        expect(readFileSync(generatedPath, 'utf-8')).toContain('## Customize This Template');

        const doctorResult = await runCommand(['doctor']);
        expect(doctorResult.code).toBe(0);
        expect(doctorResult.stderr).toBe('');
        expect(doctorResult.stdout).toContain('Starter template health checks:');
        expect(doctorResult.stdout).toContain(template.name);
        expect(doctorResult.stdout).toContain(renderRelativePath(template.targetPath));
      } finally {
        process.chdir(workRoot);
        rmSync(projectDir, { recursive: true, force: true });
      }
    }
  });
});
