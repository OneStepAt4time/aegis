import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SSEStatusIndicator } from '../SSEStatusIndicator';
import { useStore } from '../../../store/useStore';

vi.mock('../../../store/useStore');

describe('SSEStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when SSE state is default (not connected, no error)', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: null }),
    );
    const { container } = render(<SSEStatusIndicator />);
    expect(container.innerHTML).toBe('');
  });

  it('shows "Live" with green dot when connected', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: true, sseError: null }),
    );
    render(<SSEStatusIndicator />);
    expect(screen.getByText('Live')).toBeDefined();
    const status = screen.getByRole('status');
    const dot = status.querySelector('span');
    expect(dot?.style.backgroundColor).toContain('var(--color-success)');
  });

  it('shows "Reconnecting…" with yellow dot when error', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: 'Connection failed' }),
    );
    render(<SSEStatusIndicator />);
    expect(screen.getByText('Reconnecting…')).toBeDefined();
    const status = screen.getByRole('status');
    const dot = status.querySelector('span');
    expect(dot?.style.backgroundColor).toContain('var(--color-warning)');
  });

  it('has proper aria-label', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: true, sseError: null }),
    );
    render(<SSEStatusIndicator />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('SSE connection: Live');
  });

  it('uses role="status"', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: true, sseError: null }),
    );
    render(<SSEStatusIndicator />);
    expect(screen.getByRole('status')).toBeDefined();
  });
});
