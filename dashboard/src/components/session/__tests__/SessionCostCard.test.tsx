/**
 * SessionCostCard.test.tsx — Tests for per-session cost card.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionCostCard } from '../SessionCostCard';

describe('SessionCostCard', () => {
  it('renders total cost', () => {
    render(
      <SessionCostCard
        inputTokens={1000}
        outputTokens={500}
        cacheCreationTokens={200}
        cacheReadTokens={100}
        estimatedCostUsd={1.23}
      />
    );
    expect(screen.getByText('Session Cost')).toBeDefined();
  });

  it('renders token breakdown', () => {
    render(
      <SessionCostCard
        inputTokens={1000}
        outputTokens={500}
        cacheCreationTokens={200}
        cacheReadTokens={100}
        estimatedCostUsd={1.23}
      />
    );
    expect(screen.getByText('Input')).toBeDefined();
    expect(screen.getByText('Output')).toBeDefined();
    expect(screen.getByText('Cache Create')).toBeDefined();
    expect(screen.getByText('Cache Read')).toBeDefined();
  });

  it('shows total tokens', () => {
    render(
      <SessionCostCard
        inputTokens={1000}
        outputTokens={500}
        cacheCreationTokens={200}
        cacheReadTokens={100}
        estimatedCostUsd={0}
      />
    );
    // 1000 + 500 + 200 + 100 = 1800
    expect(screen.getByText(/1,800 total tokens/)).toBeDefined();
  });

  it('handles zero values', () => {
    render(
      <SessionCostCard
        inputTokens={0}
        outputTokens={0}
        cacheCreationTokens={0}
        cacheReadTokens={0}
        estimatedCostUsd={0}
      />
    );
    expect(screen.getByText(/0 total tokens/)).toBeDefined();
  });

  it('has aria-label with cost', () => {
    render(
      <SessionCostCard
        inputTokens={100}
        outputTokens={50}
        cacheCreationTokens={0}
        cacheReadTokens={0}
        estimatedCostUsd={2.50}
      />
    );
    const card = screen.getByLabelText(/Session cost.*2\.50/);
    expect(card).toBeDefined();
  });
});
