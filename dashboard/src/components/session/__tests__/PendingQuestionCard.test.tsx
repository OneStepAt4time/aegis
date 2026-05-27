/**
 * PendingQuestionCard tests — Claude question UI with optional options.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PendingQuestionCard } from '../PendingQuestionCard';
import type { PendingQuestionInfo } from '../../../types';

const baseQuestion: PendingQuestionInfo = {
  toolUseId: 'tool-1',
  content: 'What label should we use on mobile?',
  options: ['Ship it', 'Revise copy'],
  since: Date.now(),
};

describe('PendingQuestionCard', () => {
  it('renders question content', () => {
    render(<PendingQuestionCard pendingQuestion={baseQuestion} />);
    expect(screen.getByText('What label should we use on mobile?')).not.toBeNull();
  });

  it('renders "Claude needs an answer" heading', () => {
    render(<PendingQuestionCard pendingQuestion={baseQuestion} />);
    expect(screen.getByText('Claude needs an answer')).not.toBeNull();
  });

  it('renders all option buttons', () => {
    render(<PendingQuestionCard pendingQuestion={baseQuestion} />);
    expect(screen.getByRole('button', { name: 'Ship it' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Revise copy' })).not.toBeNull();
  });

  it('calls onSelectOption when option clicked', () => {
    const onSelectOption = vi.fn();
    render(
      <PendingQuestionCard
        pendingQuestion={baseQuestion}
        onSelectOption={onSelectOption}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ship it' }));
    expect(onSelectOption).toHaveBeenCalledWith('Ship it');
  });

  it('calls onSelectOption with correct option for each button', () => {
    const onSelectOption = vi.fn();
    render(
      <PendingQuestionCard
        pendingQuestion={baseQuestion}
        onSelectOption={onSelectOption}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Revise copy' }));
    expect(onSelectOption).toHaveBeenCalledWith('Revise copy');
  });

  it('renders reply hint text', () => {
    render(<PendingQuestionCard pendingQuestion={baseQuestion} />);
    expect(screen.getByText('Reply below to keep the session moving.')).not.toBeNull();
  });

  it('renders without option buttons when options is null', () => {
    const noOptionsQ: PendingQuestionInfo = {
      ...baseQuestion,
      options: null,
    };
    render(<PendingQuestionCard pendingQuestion={noOptionsQ} />);
    expect(screen.queryByRole('button')).toBeNull();
    // Content still rendered
    expect(screen.getByText('What label should we use on mobile?')).not.toBeNull();
  });

  it('renders without option buttons when options is empty array', () => {
    const emptyOptionsQ: PendingQuestionInfo = {
      ...baseQuestion,
      options: [],
    };
    render(<PendingQuestionCard pendingQuestion={emptyOptionsQ} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('works without onSelectOption callback', () => {
    render(<PendingQuestionCard pendingQuestion={baseQuestion} />);
    // Should not throw when clicking an option without callback
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Ship it' }));
    }).not.toThrow();
  });

  it('renders with single option', () => {
    const singleOptionQ: PendingQuestionInfo = {
      ...baseQuestion,
      options: ['OK'],
    };
    render(<PendingQuestionCard pendingQuestion={singleOptionQ} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('OK');
  });

  it('option buttons have min-h-[40px] for touch targets', () => {
    render(<PendingQuestionCard pendingQuestion={baseQuestion} />);
    const btn = screen.getByRole('button', { name: 'Ship it' });
    expect(btn.getAttribute('class')).toContain('min-h-[40px]');
  });
});
