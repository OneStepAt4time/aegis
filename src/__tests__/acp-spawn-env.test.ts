import { describe, expect, it } from 'vitest';

import { buildAcpSpawnEnv } from '../acp-spawn-env.js';

describe('ACP spawn environment', () => {
  it('lets Windows overrides replace existing execution keys case-insensitively', () => {
    const env = buildAcpSpawnEnv(
      { Path: 'D:\\override\\bin' },
      {},
      {
        PATH: 'D:\\source\\bin',
        SystemRoot: 'C:\\Windows',
      },
      'win32'
    );

    expect(env.Path).toBe('D:\\override\\bin');
    expect(env.PATH).toBeUndefined();
  });
});
