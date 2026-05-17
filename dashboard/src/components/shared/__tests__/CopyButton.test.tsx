/**
 * CopyButton.test.tsx — Tests for shared CopyButton component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock useCopy hook
const mockCopy = vi.fn();
vi.mock('../../../hooks/useCopy', () => ({
  useCopy: (_value: string, _label?: string) => ({
    copied: false,
    copy: mockCopy,
  }),
}));

// Must import after mock
import { CopyButton } from '../CopyButton';

describe('CopyButton', () => {
  it('renders a button', () => {
    render(<CopyButton value="test-value" />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('has aria-label with label text', () => {
    render(<CopyButton value="abc" label="session ID" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toContain('session ID');
  });

  it('has default aria-label when label omitted', () => {
    render(<CopyButton value="abc" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toContain('Copy');
  });

  it('has title attribute for tooltip', () => {
    render(<CopyButton value="abc" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('title')).toBe('Copy');
  });

  it('accepts className', () => {
    render(<CopyButton value="abc" className="custom-class" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('custom-class');
  });
});
