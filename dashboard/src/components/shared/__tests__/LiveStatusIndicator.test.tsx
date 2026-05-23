import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiveStatusIndicator from '../LiveStatusIndicator';
import { useStore } from '../../../store/useStore';

vi.mock('../../../store/useStore');

describe('LiveStatusIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Live" when SSE is connected', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: true, sseError: null }),
    );
    render(<LiveStatusIndicator />);
    expect(screen.getByText('Live')).not.toBeNull();
  });

  it('shows "Polling" when SSE is disconnected', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: null }),
    );
    render(<LiveStatusIndicator />);
    expect(screen.getByText('Polling')).not.toBeNull();
  });

  it('applies emerald styles when connected', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: true, sseError: null }),
    );
    const { container } = render(<LiveStatusIndicator />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('bg-[var(--color-success)]/10');
  });

  it('applies warning styles when disconnected', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: null }),
    );
    const { container } = render(<LiveStatusIndicator />);
    const badge = container.querySelector('span.inline-flex');
    expect(badge?.className).toContain('text-[var(--color-warning)]');
  });
});
