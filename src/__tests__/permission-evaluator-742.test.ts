import { describe, it, expect } from 'vitest';
import { evaluatePermissionProfile } from '../services/permission/index.js';

describe('Issue #742: permission profile evaluator', () => {
  it('falls back to defaultBehavior when no rule matches', () => {
    const result = evaluatePermissionProfile({ defaultBehavior: 'deny', rules: [] }, { toolName: 'Bash' });
    expect(result.behavior).toBe('deny');
  });

  it('matches exact tool rule first', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'ask' }],
    }, { toolName: 'Bash', toolInput: { command: 'git status' } });
    expect(result.behavior).toBe('ask');
  });

  it('uses wildcard pattern against command text', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'allow', pattern: 'git *' }],
    }, { toolName: 'Bash', toolInput: { command: 'git status' } });
    expect(result.behavior).toBe('allow');
  });

  it('denies write-like tools when readOnly constraint is set', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'allow',
      rules: [{ tool: 'FileWrite', behavior: 'allow', constraints: { readOnly: true } }],
    }, { toolName: 'FileWrite', toolInput: { path: 'src/x.ts', content: 'x' } });
    expect(result.behavior).toBe('deny');
  });

  it('denies paths outside allowed prefixes', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'allow',
      rules: [{ tool: 'FileEdit', behavior: 'allow', constraints: { paths: ['src/'] } }],
    }, { toolName: 'FileEdit', toolInput: { path: 'docs/readme.md' } });
    expect(result.behavior).toBe('deny');
  });

  it('denies content larger than maxFileSize', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'allow',
      rules: [{ tool: 'FileWrite', behavior: 'allow', constraints: { maxFileSize: 3 } }],
    }, { toolName: 'FileWrite', toolInput: { path: 'src/x.ts', content: '12345' } });
    expect(result.behavior).toBe('deny');
  });
});
  it('matches ? as single character wildcard', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'allow', pattern: 'git st?tus' }],
    }, { toolName: 'Bash', toolInput: { command: 'git status' } });
    expect(result.behavior).toBe('allow');
  });

  it('? does not match multiple characters', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'allow', pattern: 'git st?t' }],
    }, { toolName: 'Bash', toolInput: { command: 'git start' } });
    expect(result.behavior).toBe('deny');
  });

  it('single-star does not cross path separators', () => {
    const matched = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'allow', pattern: 'src/*/index.ts' }],
    }, { toolName: 'Bash', toolInput: { command: 'src/lib/index.ts' } });
    expect(matched.behavior).toBe('allow');

    const notMatched = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'allow', pattern: 'src/*/index.ts' }],
    }, { toolName: 'Bash', toolInput: { command: 'src/lib/utils/index.ts' } });
    expect(notMatched.behavior).toBe('deny');
  });

  it('double-star can cross path separators', () => {
    const result = evaluatePermissionProfile({
      defaultBehavior: 'deny',
      rules: [{ tool: 'Bash', behavior: 'allow', pattern: 'src/**/index.ts' }],
    }, { toolName: 'Bash', toolInput: { command: 'src/lib/utils/index.ts' } });
    expect(result.behavior).toBe('allow');
  });

