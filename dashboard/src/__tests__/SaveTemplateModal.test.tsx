import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SaveTemplateModal from '../components/SaveTemplateModal';

const mockCreateTemplate = vi.fn();

vi.mock('../api/client', () => ({
  createTemplate: (...args: unknown[]) => mockCreateTemplate(...args),
}));

const mockAddToast = vi.fn();
vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (s: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

function renderModal(open = true, onClose = vi.fn(), sessionId = 'sess-123'): ReturnType<typeof render> {
  return render(<SaveTemplateModal open={open} onClose={onClose} sessionId={sessionId} />);
}

describe('SaveTemplateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when open is false', () => {
    const { container } = renderModal(false);
    expect(container.innerHTML).toBe('');
  });

  it('renders the modal when open', () => {
    renderModal();
    expect(screen.getByText('Save as Template')).toBeDefined();
    expect(screen.getByText('Save Template')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    // Backdrop is the first div child
    const backdrop = screen.getByText('Save as Template').closest('.fixed')?.firstElementChild;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows validation error when name is empty on submit', async () => {
    renderModal();
    fireEvent.click(screen.getByText('Save Template'));
    await waitFor(() => {
      expect(screen.getByText('Template name is required')).toBeDefined();
    });
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  it('shows validation error when name is only whitespace on submit', async () => {
    renderModal();
    const nameInput = screen.getByPlaceholderText('My template name');
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save Template'));
    await waitFor(() => {
      expect(screen.getByText('Template name is required')).toBeDefined();
    });
  });

  it('calls createTemplate with name, description, and sessionId on valid submit', async () => {
    mockCreateTemplate.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderModal(true, onClose, 'sess-456');

    fireEvent.change(screen.getByPlaceholderText('My template name'), { target: { value: 'My Template' } });
    fireEvent.change(screen.getByPlaceholderText('What is this template for?'), { target: { value: 'A test template' } });

    fireEvent.click(screen.getByText('Save Template'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        name: 'My Template',
        description: 'A test template',
        sessionId: 'sess-456',
      });
    });
    expect(mockAddToast).toHaveBeenCalledWith('success', 'Template saved', '"My Template" created successfully');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits with name only when description is empty', async () => {
    mockCreateTemplate.mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderModal(true, onClose);

    fireEvent.change(screen.getByPlaceholderText('My template name'), { target: { value: 'Name Only' } });
    fireEvent.click(screen.getByText('Save Template'));

    await waitFor(() => {
      expect(mockCreateTemplate).toHaveBeenCalledWith({
        name: 'Name Only',
        description: undefined,
        sessionId: 'sess-123',
      });
    });
  });

  it('shows error message when createTemplate throws', async () => {
    mockCreateTemplate.mockRejectedValueOnce(new Error('Server error'));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText('My template name'), { target: { value: 'Fail Template' } });
    fireEvent.click(screen.getByText('Save Template'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeDefined();
    });
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('shows generic error when createTemplate throws non-Error', async () => {
    mockCreateTemplate.mockRejectedValueOnce('unknown error');
    renderModal();

    fireEvent.change(screen.getByPlaceholderText('My template name'), { target: { value: 'Generic Fail' } });
    fireEvent.click(screen.getByText('Save Template'));

    await waitFor(() => {
      expect(screen.getByText('Failed to save template')).toBeDefined();
    });
  });

  it('shows loading spinner while submitting', async () => {
    let resolvePromise: () => void;
    mockCreateTemplate.mockReturnValueOnce(new Promise<void>((resolve) => { resolvePromise = resolve; }));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText('My template name'), { target: { value: 'Loading Test' } });
    fireEvent.click(screen.getByText('Save Template'));

    await waitFor(() => {
      expect(screen.getByText(/Saving/)).toBeDefined();
    });

    resolvePromise!();
    await waitFor(() => {
      expect(screen.getByText('Save Template')).toBeDefined();
    });
  });

  it('closes on Escape key press', () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when modal is closed', () => {
    const onClose = vi.fn();
    renderModal(false, onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
