import { describe, it, expect } from 'vitest';
import { resolveTmuxTarget, type TmuxWindow } from '../tmux.js';

describe('resolveTmuxTarget', () => {
  const windows: TmuxWindow[] = [
    { windowIndex: '0', windowId: '@1', windowName: '_bridge_main', cwd: '/tmp', paneCommand: 'node', paneDead: false },
    { windowIndex: '1', windowId: '@2', windowName: 'cc-one', cwd: '/tmp/one', paneCommand: 'pwsh', paneDead: false },
    { windowIndex: '2', windowId: '@3', windowName: 'cc-two', cwd: '/tmp/two', paneCommand: 'pwsh', paneDead: false },
  ];

  it('uses the window index on win32 when the window id is known', () => {
    expect(resolveTmuxTarget('aegis', '@3', windows, 'win32')).toBe('aegis:2');
  });

  it('falls back to the window id on win32 when the index is unavailable', () => {
    expect(resolveTmuxTarget('aegis', '@99', windows, 'win32')).toBe('aegis:@99');
  });

  it('keeps using the window id on non-win32 platforms', () => {
    expect(resolveTmuxTarget('aegis', '@3', windows, 'linux')).toBe('aegis:@3');
  });
});
