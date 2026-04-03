import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateSessionModal from '../components/CreateSessionModal';

// ── Mocks ────────────────────────────────────────────────────────

const mockBatchCreateSessions = vi.fn();
const mockGetTemplates = vi.fn();
const mockCreateSession = vi.fn();

vi.mock('../api/client', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  batchCreateSessions: (...args: unknown[]) => mockBatchCreateSessions(...args),
  getTemplates: (...args: unknown[]) => mockGetTemplates(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────

function renderModal(open = true, onClose = vi.fn()): void {
  render(
    <MemoryRouter>
      <CreateSessionModal open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

/** Get all workDir inputs currently rendered in the batch form. */
function getWorkDirInputs(): HTMLInputElement[] {
  return Array.from(
    screen.getAllByPlaceholderText('/home/user/project'),
  ) as HTMLInputElement[];
}

// ── Tests ────────────────────────────────────────────────────────

describe('CreateSessionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplates.mockResolvedValue([]);
  });

  // ── Tab bar ─────────────────────────────────────────────────────

  it('renders Single and Batch tab buttons', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Single' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Batch' })).toBeDefined();
  });

  // ── Batch mode switching ────────────────────────────────────────

  it('shows single form by default and batch form after clicking Batch', () => {
    renderModal();

    // Single form should show its work dir input
    expect(screen.getByPlaceholderText('/home/user/project')).toBeDefined();

    // Click Batch tab
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    // Batch-specific elements appear
    expect(screen.getByText('Shared Prompt')).toBeDefined();
    expect(screen.getByPlaceholderText('Apply to all sessions without a per-row prompt...')).toBeDefined();
    expect(screen.getByText('Add session')).toBeDefined();
  });

  // ── Default rows ────────────────────────────────────────────────

  it('shows two workDir input rows by default in batch mode', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    const inputs = getWorkDirInputs();
    expect(inputs).toHaveLength(2);
  });

  // ── Add row ─────────────────────────────────────────────────────

  it('adds a third row when "Add session" is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    expect(getWorkDirInputs()).toHaveLength(2);

    fireEvent.click(screen.getByText('Add session'));

    expect(getWorkDirInputs()).toHaveLength(3);
  });

  // ── Submit payload with shared prompt ───────────────────────────

  it('calls batchCreateSessions with shared prompt for rows without per-row prompt', async () => {
    const mockResult = {
      sessions: [
        { id: 'abc12345-def6-7890-abcd-ef1234567890', name: 'proj-a' },
        { id: 'def67890-abc1-2345-def6-7890abcdef12', name: 'proj-b' },
      ],
      created: 2,
      failed: 0,
      errors: [],
    };
    mockBatchCreateSessions.mockResolvedValueOnce(mockResult);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    // Fill shared prompt
    const sharedPromptEl = screen.getByPlaceholderText(
      'Apply to all sessions without a per-row prompt...',
    );
    fireEvent.change(sharedPromptEl, { target: { value: 'Run all tests' } });

    // Fill first workDir
    const workDirInputs = getWorkDirInputs();
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    // Fill second workDir
    fireEvent.change(workDirInputs[1], { target: { value: '/home/user/proj-b' } });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Create.*Session/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockBatchCreateSessions).toHaveBeenCalledTimes(1);
    });

    const callArg = mockBatchCreateSessions.mock.calls[0][0] as {
      sessions: Array<{ workDir: string; prompt?: string; permissionMode?: string }>;
    };
    expect(callArg.sessions).toHaveLength(2);
    expect(callArg.sessions[0]).toMatchObject({
      workDir: '/home/user/proj-a',
      prompt: 'Run all tests',
    });
    expect(callArg.sessions[1]).toMatchObject({
      workDir: '/home/user/proj-b',
      prompt: 'Run all tests',
    });
  });

  // ── Per-row prompt overrides shared prompt ──────────────────────

  it('uses per-row prompt when set, falling back to shared prompt for other rows', async () => {
    const mockResult = {
      sessions: [
        { id: 'aaa11111-bbb2-3333-ccc4-555555555555', name: '' },
        { id: 'bbb22222-ccc3-4444-ddd5-666666666666', name: '' },
      ],
      created: 2,
      failed: 0,
      errors: [],
    };
    mockBatchCreateSessions.mockResolvedValueOnce(mockResult);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    // Shared prompt
    const sharedPromptEl = screen.getByPlaceholderText(
      'Apply to all sessions without a per-row prompt...',
    );
    fireEvent.change(sharedPromptEl, { target: { value: 'shared prompt' } });

    // Row 0: per-row prompt override
    const overrideInputs = screen.getAllByPlaceholderText('Override prompt...') as HTMLInputElement[];
    fireEvent.change(overrideInputs[0], { target: { value: 'custom row prompt' } });

    // Fill both workDirs
    const workDirInputs = getWorkDirInputs();
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });
    fireEvent.change(workDirInputs[1], { target: { value: '/home/user/proj-b' } });

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Create.*Session/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockBatchCreateSessions).toHaveBeenCalledTimes(1);
    });

    const callArg = mockBatchCreateSessions.mock.calls[0][0] as {
      sessions: Array<{ workDir: string; prompt?: string }>;
    };
    // Row 0 should use its per-row prompt
    expect(callArg.sessions[0].prompt).toBe('custom row prompt');
    // Row 1 should fall back to the shared prompt
    expect(callArg.sessions[1].prompt).toBe('shared prompt');
  });

  // ── Results display: success ────────────────────────────────────

  it('displays created count and session names after successful creation', async () => {
    const mockResult = {
      sessions: [
        { id: 'abc12345-def6-7890-abcd-ef1234567890', name: 'proj-a' },
        { id: 'def67890-abc1-2345-def6-7890abcdef12', name: 'proj-b' },
      ],
      created: 2,
      failed: 0,
      errors: [],
    };
    mockBatchCreateSessions.mockResolvedValueOnce(mockResult);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    // Fill and submit
    const workDirInputs = getWorkDirInputs();
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });
    fireEvent.change(workDirInputs[1], { target: { value: '/home/user/proj-b' } });

    const submitBtn = screen.getByRole('button', { name: /Create.*Session/i });
    fireEvent.click(submitBtn);

    // Wait for results to appear
    await waitFor(() => {
      expect(screen.getByText('2 created')).toBeDefined();
    });

    // Check session links with truncated IDs
    expect(screen.getByText('abc12345... - proj-a')).toBeDefined();
    expect(screen.getByText('def67890... - proj-b')).toBeDefined();

    // No failures
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  // ── Results display: partial failure ────────────────────────────

  it('displays errors when partial failure occurs', async () => {
    const mockResult = {
      sessions: [
        { id: 'abc12345-def6-7890-abcd-ef1234567890', name: 'proj-a' },
      ],
      created: 1,
      failed: 1,
      errors: ['Permission denied for /home/user/proj-b'],
    };
    mockBatchCreateSessions.mockResolvedValueOnce(mockResult);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    // Fill and submit
    const workDirInputs = getWorkDirInputs();
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });
    fireEvent.change(workDirInputs[1], { target: { value: '/home/user/proj-b' } });

    const submitBtn = screen.getByRole('button', { name: /Create.*Session/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText('1 created')).toBeDefined();
    });
    expect(screen.getByText('1 failed')).toBeDefined();
    expect(screen.getByText('Permission denied for /home/user/proj-b')).toBeDefined();
  });

  // ── Submit disabled when no workDir filled ──────────────────────

  it('disables submit button when no workDir is filled in batch mode', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    const submitBtn = screen.getByRole('button', { name: /Create.*Session/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  // ── Submit enabled when at least one workDir is filled ──────────

  it('enables submit button when at least one workDir is filled', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Batch' }));

    const submitBtn = screen.getByRole('button', { name: /Create.*Session/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Fill one workDir
    const workDirInputs = getWorkDirInputs();
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    expect(submitBtn.disabled).toBe(false);
  });
});
