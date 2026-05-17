/**
 * LiveStatusIndicator tests — SSE connection status badge.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useStore } from '../../store/useStore';
import LiveStatusIndicator from './LiveStatusIndicator';

vi.mock('../../store/useStore');

const mockedUseStore = vi.mocked(useStore);

function renderWithState(sseConnected: boolean) {
  mockedUseStore.mockReturnValue(sseConnected);
  return render(<LiveStatusIndicator />);
}

describe('LiveStatusIndicator', () => {
  it('shows "Live" when SSE connected', () => {
    renderWithState(true);
    expect(screen.getByText('Live')).not.toBeNull();
  });

  it('shows "Polling" when SSE disconnected', () => {
    renderWithState(false);
    expect(screen.getByText('Polling')).not.toBeNull();
  });

  it('renders ping animation when connected', () => {
    const { container } = renderWithState(true);
    expect(container.querySelector('.animate-ping')).not.toBeNull();
  });

  it('has no ping animation when disconnected', () => {
    const { container } = renderWithState(false);
    expect(container.querySelector('.animate-ping')).toBeNull();
  });
});
