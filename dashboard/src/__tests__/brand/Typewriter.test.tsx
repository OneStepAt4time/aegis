/**
 * __tests__/brand/Typewriter.test.tsx
 *
 * Unit tests for Typewriter component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Typewriter } from '../../components/brand/Typewriter';

describe('Typewriter', () => {
  it('renders initial empty text', () => {
    const { container } = render(<Typewriter text="Hello" />);
    expect(container.textContent).toBe('');
  });

  it('types characters sequentially and calls onDone', async () => {
    const onDone = vi.fn();
    render(<Typewriter text="Test" speed={10} onDone={onDone} />);

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeTruthy();
    }, { timeout: 200 });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('applies custom className', () => {
    const { container } = render(<Typewriter text="Hi" className="custom-class" />);
    expect(container.querySelector('.custom-class')).not.toBeNull();
  });
});
