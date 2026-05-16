/**
 * clipboard.test.ts — Tests for robust copy-to-clipboard utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyToClipboard } from '../clipboard';

describe('copyToClipboard', () => {
  let mockExecCommand: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Default: modern clipboard API available
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    // Mock document.execCommand for jsdom (not available by default)
    mockExecCommand = vi.fn().mockReturnValue(true);
    document.execCommand = mockExecCommand as unknown as typeof document.execCommand;
  });

  afterEach(() => {
    mockExecCommand.mockRestore?.();
  });

  it('uses navigator.clipboard.writeText when available', async () => {
    const result = await copyToClipboard('hello');
    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it('returns true when navigator.clipboard.writeText succeeds', async () => {
    const result = await copyToClipboard('test-command');
    expect(result).toBe(true);
  });

  it('falls back to textarea execCommand when clipboard API rejects', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException('Not allowed')) },
    });

    const result = await copyToClipboard('fallback-text');
    expect(result).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to textarea execCommand when navigator.clipboard is missing', async () => {
    // @ts-expect-error — testing missing clipboard API
    delete navigator.clipboard;

    const result = await copyToClipboard('no-api-text');
    expect(result).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when both clipboard API and execCommand fail', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('fail')) },
    });
    mockExecCommand.mockReturnValue(false);

    const result = await copyToClipboard('double-fail');
    expect(result).toBe(false);
  });

  it('returns false when clipboard API missing and execCommand throws', async () => {
    // @ts-expect-error — testing missing clipboard API
    delete navigator.clipboard;
    mockExecCommand.mockImplementation(() => { throw new Error('no exec'); });

    const result = await copyToClipboard('exec-throws');
    expect(result).toBe(false);
  });

  it('creates and removes temporary textarea during fallback', async () => {
    // @ts-expect-error — testing missing clipboard API
    delete navigator.clipboard;

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    await copyToClipboard('cleanup-test');

    // Should have appended and removed a textarea
    const appended = appendSpy.mock.calls[0]?.[0] as HTMLTextAreaElement;
    expect(appended?.tagName).toBe('TEXTAREA');
    expect(appended?.value).toBe('cleanup-test');
    expect(removeSpy).toHaveBeenCalledWith(appended);

    appendSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('textarea fallback sets value correctly before copy', async () => {
    // @ts-expect-error — testing missing clipboard API
    delete navigator.clipboard;

    let capturedValue = '';
    mockExecCommand.mockImplementation(() => {
      const allTa = document.querySelectorAll('textarea');
      if (allTa.length > 0 && allTa[0]) {
        capturedValue = (allTa[0] as HTMLTextAreaElement).value;
      }
      return true;
    });

    await copyToClipboard('verify-value');
    expect(capturedValue).toBe('verify-value');
  });
});
