/**
 * IsolationModeBadge.test.tsx — Tests for #3539.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { IsolationModeBadge } from '../IsolationModeBadge';

describe('IsolationModeBadge (#3539)', () => {
  it('renders nothing when isolationMode is undefined', () => {
    const { container } = render(<IsolationModeBadge />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when isolationMode is null', () => {
    const { container } = render(<IsolationModeBadge isolationMode={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders worktree badge with green styling', () => {
    const { container, getByTitle } = render(<IsolationModeBadge isolationMode="worktree" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('Worktree');
    expect(getByTitle(/isolated worktree/i)).toBeTruthy();
  });

  it('renders none badge with warning styling', () => {
    const { container, getByTitle } = render(<IsolationModeBadge isolationMode="none" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('Direct');
    expect(getByTitle(/directly/i)).toBeTruthy();
  });

  it('renders unknown mode with muted styling', () => {
    const { container, getByTitle } = render(<IsolationModeBadge isolationMode="custom" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe('custom');
    expect(getByTitle(/Isolation: custom/)).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(<IsolationModeBadge isolationMode="worktree" className="hidden sm:inline-flex" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('hidden');
  });
});
