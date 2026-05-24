import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ApprovalTransition } from '../ApprovalTransition';

describe('ApprovalTransition', () => {
  it('renders nothing when no transition', () => {
    const { container } = render(
      <ApprovalTransition previousStatus="idle" currentStatus="working" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders approved flash when transitioning from awaiting_approval to working', () => {
    const { container } = render(
      <ApprovalTransition previousStatus="awaiting_approval" currentStatus="working" />,
    );
    expect(container.innerHTML).not.toBe('');
    expect(container.querySelector('[class*="success"]')).toBeTruthy();
  });

  it('renders rejected flash when transitioning from awaiting_approval to killed', () => {
    const { container } = render(
      <ApprovalTransition previousStatus="awaiting_approval" currentStatus="killed" />,
    );
    expect(container.innerHTML).not.toBe('');
    expect(container.querySelector('[class*="danger"]')).toBeTruthy();
  });
});
