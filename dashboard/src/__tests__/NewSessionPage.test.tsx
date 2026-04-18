import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NewSessionPage from '../pages/NewSessionPage';

// ── Mocks ────────────────────────────────────────────────────────

const mockCreateSession = vi.fn();
const mockGetTemplates = vi.fn();
const mockNavigate = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../api/client', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getTemplates: (...args: unknown[]) => mockGetTemplates(...args),
}));

vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (state: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ── Helpers ──────────────────────────────────────────────────────

/** Labels contain child spans ("*", "(optional)") — use exact:false. */
function getField(name: string) {
  return screen.getByLabelText(name, { exact: false });
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <NewSessionPage />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(mockGetTemplates).toHaveBeenCalledTimes(1);
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('NewSessionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplates.mockResolvedValue([]);
  });

  // ── Renders form ────────────────────────────────────────────────

  it('renders the form with all required fields', async () => {
    await renderPage();

    expect(screen.getByText('New Session')).toBeDefined();
    expect(screen.getByText('Create a new Aegis session')).toBeDefined();
    expect(getField('Working Directory')).toBeDefined();
    expect(getField('Session Name')).toBeDefined();
    expect(getField('Claude Command')).toBeDefined();
    expect(getField('Initial Prompt')).toBeDefined();
    expect(screen.getByLabelText('Permission Mode')).toBeDefined();
    expect(screen.getByRole('button', { name: /Create Session/i })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.getByTitle('Go back')).toBeDefined();
  });

  // ── Submit disabled when workDir empty ──────────────────────────

  it('disables submit button when workDir is empty', async () => {
    await renderPage();

    const submitBtn = screen.getByRole('button', { name: /Create Session/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  // ── Submit enabled when workDir filled ──────────────────────────

  it('enables submit button when workDir is filled', async () => {
    await renderPage();

    const submitBtn = screen.getByRole('button', { name: /Create Session/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(getField('Working Directory'), {
      target: { value: '/home/user/project' },
    });

    expect(submitBtn.disabled).toBe(false);
  });

  // ── Submit creates session and navigates ────────────────────────

  it('creates session and navigates on submit', async () => {
    const sessionId = 'sess-abc-123';
    mockCreateSession.mockResolvedValueOnce({ id: sessionId });

    await renderPage();

    fireEvent.change(getField('Working Directory'), {
      target: { value: '/home/user/myapp' },
    });
    fireEvent.change(getField('Session Name'), {
      target: { value: 'my-session' },
    });
    fireEvent.change(getField('Initial Prompt'), {
      target: { value: 'Fix the tests' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Session/i }));
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workDir: '/home/user/myapp',
        name: 'my-session',
        prompt: 'Fix the tests',
      }),
    );

    expect(mockNavigate).toHaveBeenCalledWith(`/sessions/${sessionId}`);
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Session created', sessionId);
  });

  // ── Sends permissionMode when not default ───────────────────────

  it('sends permissionMode when changed from default', async () => {
    mockCreateSession.mockResolvedValueOnce({ id: 'sess-xyz' });

    await renderPage();

    fireEvent.change(getField('Working Directory'), {
      target: { value: '/app' },
    });
    fireEvent.change(screen.getByLabelText('Permission Mode'), {
      target: { value: 'bypassPermissions' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Session/i }));
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          permissionMode: 'bypassPermissions',
        }),
      );
    });
  });

  // ── Omits optional fields when empty ────────────────────────────

  it('omits optional fields when empty', async () => {
    mockCreateSession.mockResolvedValueOnce({ id: 'sess-min' });

    await renderPage();

    fireEvent.change(getField('Working Directory'), {
      target: { value: '/app' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Session/i }));
    });

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith({
        workDir: '/app',
      });
    });
  });

  // ── Error handling ──────────────────────────────────────────────

  it('shows error toast on creation failure', async () => {
    mockCreateSession.mockRejectedValueOnce(new Error('Server unreachable'));

    await renderPage();

    fireEvent.change(getField('Working Directory'), {
      target: { value: '/app' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Session/i }));
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Creation failed', 'Server unreachable');
    });
  });

  // ── Non-Error rejection ─────────────────────────────────────────

  it('handles non-Error rejection with generic message', async () => {
    mockCreateSession.mockRejectedValueOnce('unknown');

    await renderPage();

    fireEvent.change(getField('Working Directory'), {
      target: { value: '/app' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Create Session/i }));
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Creation failed', 'Failed to create session');
    });
  });

  // ── Cancel navigates back ───────────────────────────────────────

  it('navigates back on Cancel click', async () => {
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  // ── Back arrow navigates back ───────────────────────────────────

  it('navigates back on back arrow click', async () => {
    await renderPage();

    fireEvent.click(screen.getByTitle('Go back'));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  // ── Templates hint ──────────────────────────────────────────────

  it('shows template count when templates are available', async () => {
    mockGetTemplates.mockResolvedValueOnce([
      { id: 't1', name: 'Template 1' },
      { id: 't2', name: 'Template 2' },
    ] as unknown[]);

    await renderPage();

    expect(await screen.findByText(/2 templates available/)).toBeDefined();
  });
});
