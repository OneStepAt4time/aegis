/**
 * session-name.test.ts — Tests for friendly session display names (#3489).
 */

import { describe, it, expect } from 'vitest';
import { deriveSessionName, generateSessionName } from '../utils/session-name.js';

describe('deriveSessionName', () => {
  it('extracts verb-noun pair from prompt', () => {
    expect(deriveSessionName('Build a REST API for user management')).toBe('build-rest-api');
  });

  it('extracts fix-verb phrases', () => {
    expect(deriveSessionName('Fix the flaky test in SessionTable')).toBe('fix-flaky-test');
  });

  it('handles single-word prompts', () => {
    expect(deriveSessionName('Hello')).toBe('hello');
  });

  it('handles prompts without recognized verbs', () => {
    expect(deriveSessionName('user authentication flow')).toBe('user-authentication-flow');
  });

  it('handles empty string', () => {
    expect(deriveSessionName('')).toBe('untitled');
  });

  it('handles whitespace-only string', () => {
    expect(deriveSessionName('   ')).toBe('untitled');
  });

  it('strips punctuation', () => {
    expect(deriveSessionName('Fix: the "bug" in /api/users')).toBe('fix-bug-api');
  });

  it('handles "refactor" verb', () => {
    expect(deriveSessionName('Refactor the session manager to use Zustand')).toBe('refactor-session-manager');
  });

  it('handles "implement" verb', () => {
    expect(deriveSessionName('Implement dark mode toggle for settings page')).toBe('implement-dark-mode');
  });

  it('handles "add" verb', () => {
    expect(deriveSessionName('Add a logout button to the navbar')).toBe('add-logout-button');
  });

  it('handles "write" verb', () => {
    expect(deriveSessionName('Write tests for the auth module')).toBe('write-tests-auth');
  });

  it('limits to 3 parts', () => {
    expect(deriveSessionName('Build a full stack app with React and Node and PostgreSQL')).toBe('build-full-stack');
  });

  it('strips stop words', () => {
    expect(deriveSessionName('The quick brown fox')).toBe('quick-brown-fox');
  });
});

describe('generateSessionName', () => {
  it('generates name with prefix', () => {
    expect(generateSessionName('Build a login page')).toBe('cc-build-login-page');
  });

  it('generates name with session ID prefix', () => {
    expect(generateSessionName('Fix the bug', 'a1b2')).toBe('cc-fix-bug-a1b2');
  });

  it('handles empty prompt', () => {
    expect(generateSessionName('')).toBe('cc-untitled');
  });
});
