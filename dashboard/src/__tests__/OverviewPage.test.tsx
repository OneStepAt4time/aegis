import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OverviewPage from '../pages/OverviewPage';
import { I18nProvider } from '../i18n/context';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('../components/overview/MetricCards', () => ({
  default: () => <div data-testid="metric-cards">MetricCards</div>,
}));

vi.mock('../components/overview/MetricsPanel', () => ({
  default: () => <div data-testid="metrics-panel">MetricsPanel</div>,
}));

vi.mock('../components/overview/HomeStatusPanel', () => ({
  default: ({ onCreateFirstSession }: { onCreateFirstSession: () => void }) => (
    <div data-testid="home-status-panel">
      <button onClick={onCreateFirstSession}>Create first session</button>
    </div>
  ),
}));

vi.mock('../components/overview/SessionTable', () => ({
  default: () => <div data-testid="session-table">SessionTable</div>,
}));

vi.mock('../components/LiveAuditStream', () => ({
  default: () => <div data-testid="live-audit-stream">LiveAuditStream</div>,
}));

vi.mock('../components/CreateSessionModal', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="create-session-modal">
        <button onClick={onClose}>Close Modal</button>
      </div>
    ) : null,
}));

vi.mock('../components/shared/LiveStatusIndicator', () => ({
  default: () => <span data-testid="live-status">Live</span>,
}));

// ── Helpers ──────────────────────────────────────────────────────

function renderPage(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <OverviewPage />
    </I18nProvider>
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Overview heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
    });
  });

  it('renders subtitle text', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/System health and session controls/)).toBeDefined();
    });
  });

  it('renders the New Session button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeDefined();
    });
  });

  it('renders all child components', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('home-status-panel')).toBeDefined();
      expect(screen.getByTestId('session-table')).toBeDefined();
      expect(screen.getByTestId('live-status')).toBeDefined();
    });
  });

  it('renders the Sessions section heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Recent Sessions')).toBeDefined();
    });
  });

  it('opens create session modal when New Session button is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeDefined();
    });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
    fireEvent.click(screen.getByText('New Session'));
    await waitFor(() => {
      expect(screen.getByTestId('create-session-modal')).toBeDefined();
    });
  });

  it('closes the modal when onClose is called', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeDefined();
    });
    fireEvent.click(screen.getByText('New Session'));
    await waitFor(() => {
      expect(screen.getByTestId('create-session-modal')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Close Modal'));
    await waitFor(() => {
      expect(screen.queryByTestId('create-session-modal')).toBeNull();
    });
  });

  it('opens create session modal when Create first session CTA is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Create first session')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Create first session'));
    await waitFor(() => {
      expect(screen.getByTestId('create-session-modal')).toBeDefined();
    });
  });

  it('opens modal on "n" key press', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
    });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
    fireEvent.keyDown(window, { key: 'n' });
    await waitFor(() => {
      expect(screen.getByTestId('create-session-modal')).toBeDefined();
    });
  });

  it('does not open modal on "n" with modifier keys', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
    });
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
    fireEvent.keyDown(window, { key: 'n', altKey: true });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
  });

  it('does not open modal when typing in an input', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'n' });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
    document.body.removeChild(input);
  });

  it('does not open modal when typing in a textarea', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
    });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    fireEvent.focus(textarea);
    fireEvent.keyDown(textarea, { key: 'n' });
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
    document.body.removeChild(textarea);
  });

  it('cleans up keydown listener on unmount', async () => {
    const { unmount } = render(
      <MemoryRouter>
      <I18nProvider>
        <OverviewPage />
      </I18nProvider>
    </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeDefined();
    });
    unmount();
    fireEvent.keyDown(window, { key: 'n' });
    // Modal should not appear since listener was removed
    expect(screen.queryByTestId('create-session-modal')).toBeNull();
  });
});
