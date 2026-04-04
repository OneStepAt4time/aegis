import { describe, it, expect } from 'vitest';
import { buildHookCommand } from '../hook.js';
import { buildProjectSettingsPath } from '../hook-settings.js';

describe('Issue #909: hook command path normalization', () => {
  it('quotes and normalizes Unix paths', () => {
    const cmd = buildHookCommand('/tmp/aegis dist/hook.js', '/usr/local/bin/node', 'linux');
    expect(cmd).toBe('"/usr/local/bin/node" "/tmp/aegis dist/hook.js"');
  });

  it('quotes and normalizes Windows paths with spaces', () => {
    const cmd = buildHookCommand('D:/Aegis Work/dist/hook.js', 'C:/Program Files/nodejs/node.exe', 'win32');
    expect(cmd).toBe('"C:\\Program Files\\nodejs\\node.exe" "D:\\Aegis Work\\dist\\hook.js"');
  });
});

describe('Issue #909: hook settings path construction', () => {
  it('builds Unix settings.local.json path', () => {
    const settingsPath = buildProjectSettingsPath('/home/user/my-repo', 'linux');
    expect(settingsPath.replace(/\\/g, '/')).toContain('/home/user/my-repo/.claude/settings.local.json');
  });

  it('builds Windows settings.local.json path from slash input', () => {
    const settingsPath = buildProjectSettingsPath('D:/Users/dev/My Repo', 'win32');
    expect(settingsPath).toContain('D:\\Users\\dev\\My Repo\\.claude\\settings.local.json');
  });
});
