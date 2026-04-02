/**
 * approve-strategy.test.ts — Tests for approve() numbered-option detection.
 *
 * CC sometimes shows numbered options (1. Yes, 2. No) instead of y/N.
 * The approve method must detect this and send "1" instead of "y".
 */

import { describe, it, expect } from 'vitest';
import { detectApprovalMethod } from '../session.js';

describe('detectApprovalMethod', () => {
  it('should detect numbered options and return "numbered"', () => {
    const paneText = `Do you want to allow Claude to edit this file?

  1. Yes, always for this file
  2. Yes
  3. No

  Esc to cancel`;

    expect(detectApprovalMethod(paneText)).toBe('numbered');
  });

  it('should detect simple numbered options (1. Yes, 2. No)', () => {
    const paneText = `Do you want to proceed?

  1. Yes
  2. No

  Esc to cancel`;

    expect(detectApprovalMethod(paneText)).toBe('numbered');
  });

  it('should detect MCP tool permission numbered options', () => {
    const paneText = `Do you want to allow Claude to use the GitHub MCP tool?

  1. Yes, always
  2. Yes
  3. No

  Esc to cancel`;

    expect(detectApprovalMethod(paneText)).toBe('numbered');
  });

  it('should detect numbered options with file list above', () => {
    const paneText = `3 files will be modified
  - src/foo.ts
  - src/bar.ts
  - src/baz.ts

  1. Yes
  2. No

  Esc to cancel`;

    expect(detectApprovalMethod(paneText)).toBe('numbered');
  });

  it('should return "yes" when no numbered options present', () => {
    const paneText = `Allow Claude to run this command? (y/n)`;

    expect(detectApprovalMethod(paneText)).toBe('yes');
  });

  it('should return "yes" for idle pane text', () => {
    const paneText = `❯ What would you like to do?`;

    expect(detectApprovalMethod(paneText)).toBe('yes');
  });

  it('should return "yes" for empty pane text', () => {
    expect(detectApprovalMethod('')).toBe('yes');
  });

  it('should not false-positive on regular numbered lists in output', () => {
    const paneText = `Here are the results:
1. First item
2. Second item
3. Third item

The analysis is complete.`;

    expect(detectApprovalMethod(paneText)).toBe('yes');
  });

  it('should not false-positive on indented numbered list without Esc to cancel (Issue #843)', () => {
    const paneText = `Here are the steps to follow:

  1. First, clone the repo
  2. Then run npm install
  3. Finally, start the server

This should work for most setups.`;

    expect(detectApprovalMethod(paneText)).toBe('yes');
  });

  it('should detect numbered options near Esc to cancel pattern', () => {
    const paneText = `Continue?

  1. Yes
  2. No

  Esc to cancel`;

    expect(detectApprovalMethod(paneText)).toBe('numbered');
  });
});
