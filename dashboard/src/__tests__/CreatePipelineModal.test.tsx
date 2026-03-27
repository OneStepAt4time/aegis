import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreatePipelineModal from '../components/CreatePipelineModal';

const mockCreatePipeline = vi.fn();

vi.mock('../api/client', () => ({
  createPipeline: (...args: unknown[]) => mockCreatePipeline(...args),
}));

function renderModal(open = true, onClose = vi.fn()): void {
  render(
    <MemoryRouter>
      <CreatePipelineModal open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe('CreatePipelineModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    renderModal(false);
    expect(screen.queryByText('New Pipeline')).toBeNull();
  });

  it('renders form with pipeline name input when open', () => {
    renderModal();
    expect(screen.getByLabelText('Pipeline Name')).toBeDefined();
  });

  it('shows two step rows by default', () => {
    renderModal();
    const inputs = screen.getAllByPlaceholderText('/home/user/project');
    expect(inputs).toHaveLength(2);
  });

  it('adds a step when "Add Step" is clicked', () => {
    renderModal();
    fireEvent.click(screen.getByText('Add Step'));
    const inputs = screen.getAllByPlaceholderText('/home/user/project');
    expect(inputs).toHaveLength(3);
  });

  it('removes a step when trash button is clicked', () => {
    renderModal();
    expect(screen.getAllByPlaceholderText('/home/user/project')).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Remove step 1'));
    expect(screen.getAllByPlaceholderText('/home/user/project')).toHaveLength(1);
  });

  it('disables submit when pipeline name is empty', () => {
    renderModal();
    const submitBtn = screen.getByRole('button', { name: /Create Pipeline/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('enables submit when pipeline name and at least one workDir are filled', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Pipeline Name'), { target: { value: 'Test Pipeline' } });
    const workDirInputs = screen.getAllByPlaceholderText('/home/user/project');
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    const submitBtn = screen.getByRole('button', { name: /Create Pipeline/i }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('calls createPipeline and navigates on submit', async () => {
    const mockPipeline = {
      id: 'pipe-123',
      name: 'Test Pipeline',
      status: 'pending',
      sessions: [],
      createdAt: new Date().toISOString(),
    };
    mockCreatePipeline.mockResolvedValueOnce(mockPipeline);

    renderModal();
    fireEvent.change(screen.getByLabelText('Pipeline Name'), { target: { value: 'Test Pipeline' } });
    const workDirInputs = screen.getAllByPlaceholderText('/home/user/project');
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Pipeline/i }));

    await waitFor(() => {
      expect(mockCreatePipeline).toHaveBeenCalledTimes(1);
    });

    const callArg = mockCreatePipeline.mock.calls[0][0] as {
      name: string;
      sessions: Array<{ workDir: string }>;
    };
    expect(callArg.name).toBe('Test Pipeline');
    expect(callArg.sessions).toHaveLength(1);
    expect(callArg.sessions[0].workDir).toBe('/home/user/proj-a');
  });

  it('shows error message on failure', async () => {
    mockCreatePipeline.mockRejectedValueOnce(new Error('Server error'));

    renderModal();
    fireEvent.change(screen.getByLabelText('Pipeline Name'), { target: { value: 'Test Pipeline' } });
    const workDirInputs = screen.getAllByPlaceholderText('/home/user/project');
    fireEvent.change(workDirInputs[0], { target: { value: '/home/user/proj-a' } });

    fireEvent.click(screen.getByRole('button', { name: /Create Pipeline/i }));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeDefined();
    });
  });
});
