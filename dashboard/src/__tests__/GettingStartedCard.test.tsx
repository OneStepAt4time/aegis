/**
 * __tests__/GettingStartedCard.test.tsx
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GettingStartedCard from '../components/shared/GettingStartedCard';

describe('GettingStartedCard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders when totalSessions < 3', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
    expect(screen.getByText('Create First Session')).toBeTruthy();
  });

  it('does not render when totalSessions >= 3', () => {
    render(<GettingStartedCard totalSessions={3} onCreateSession={vi.fn()} />);
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
  });

  it('does not render when totalSessions > 3', () => {
    render(<GettingStartedCard totalSessions={10} onCreateSession={vi.fn()} />);
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
  });

  it('calls onCreateSession when CTA is clicked', () => {
    const onCreate = vi.fn();
    render(<GettingStartedCard totalSessions={0} onCreateSession={onCreate} />);
    fireEvent.click(screen.getByText('Create First Session'));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('dismisses and sets localStorage', () => {
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Dismiss getting started card'));
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
    expect(localStorage.getItem('aegis-getting-started-dismissed')).toBe('true');
  });

  it('does not render if previously dismissed', () => {
    localStorage.setItem('aegis-getting-started-dismissed', 'true');
    render(<GettingStartedCard totalSessions={0} onCreateSession={vi.fn()} />);
    expect(screen.queryByText('Welcome to Aegis')).toBeNull();
  });

  it('renders for 1 and 2 sessions', () => {
    const { rerender } = render(
      <GettingStartedCard totalSessions={1} onCreateSession={vi.fn()} />
    );
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();

    rerender(<GettingStartedCard totalSessions={2} onCreateSession={vi.fn()} />);
    expect(screen.getByText('Welcome to Aegis')).toBeTruthy();
  });
});
