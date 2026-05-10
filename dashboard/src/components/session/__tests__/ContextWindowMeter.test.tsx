/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ContextWindowMeter } from '../ContextWindowMeter';

describe('ContextWindowMeter', () => {
  it('renders with low usage (green)', () => {
    render(<ContextWindowMeter usedTokens={10_000} maxTokens={200_000} />);
    expect(screen.getByLabelText(/Context usage: 5%/)).toBeDefined();
    expect(screen.getByText(/10K/)).toBeDefined();
  });

  it('renders with medium usage (yellow)', () => {
    render(<ContextWindowMeter usedTokens={120_000} maxTokens={200_000} />);
    expect(screen.getByLabelText(/Context usage: 60%/)).toBeDefined();
  });

  it('renders with high usage (red)', () => {
    render(<ContextWindowMeter usedTokens={180_000} maxTokens={200_000} />);
    expect(screen.getByLabelText(/Context usage: 90%/)).toBeDefined();
    expect(screen.getByText(/Context nearly full/)).toBeDefined();
  });

  it('renders compact mode', () => {
    render(<ContextWindowMeter usedTokens={50_000} maxTokens={200_000} compact />);
    expect(screen.getByLabelText(/Context usage: 25%/)).toBeDefined();
    expect(screen.getByText('25%')).toBeDefined();
  });

  it('hides label when showLabel is false', () => {
    render(<ContextWindowMeter usedTokens={10_000} maxTokens={200_000} showLabel={false} />);
    expect(screen.queryByText(/10K/)).toBeNull();
  });

  it('caps percentage at 100%', () => {
    render(<ContextWindowMeter usedTokens={300_000} maxTokens={200_000} />);
    expect(screen.getByLabelText(/Context usage: 100%/)).toBeDefined();
  });

  it('uses default 200K context window', () => {
    render(<ContextWindowMeter usedTokens={100_000} />);
    expect(screen.getByText(/100K/)).toBeDefined();
  });

  it('shows warning at 75% usage', () => {
    render(<ContextWindowMeter usedTokens={150_000} maxTokens={200_000} />);
    expect(screen.getByText(/Context filling up/)).toBeDefined();
  });
});
