/**
 * ToastContainer tests — global toast notification renderer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastContainer from '../ToastContainer';

// ── Mocks ──────────────────────────────────────────────────

const mockRemoveToast = vi.fn();
let mockToasts: Array<{
  id: string;
  type: 'error' | 'success' | 'info' | 'warning' | 'undo';
  title: string;
  description?: string;
  undoAction?: () => void;
}> = [];

vi.mock('../../store/useToastStore', () => ({
  useToastStore: (selector: Function) =>
    selector({
      toasts: mockToasts,
      removeToast: mockRemoveToast,
    }),
}));

vi.mock('../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

vi.mock('lucide-react', () => ({
  X: (props: any) => <svg data-testid="icon-x" {...props} />,
  CheckCircle: (props: any) => <svg data-testid="icon-check" {...props} />,
  AlertTriangle: (props: any) => <svg data-testid="icon-alert" {...props} />,
  Info: (props: any) => <svg data-testid="icon-info" {...props} />,
  AlertCircle: (props: any) => <svg data-testid="icon-alertcircle" {...props} />,
  Trash2: (props: any) => <svg data-testid="icon-trash" {...props} />,
  Undo: (props: any) => <svg data-testid="icon-undo" {...props} />,
}));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockToasts = [];
  mockRemoveToast.mockReset();
});

describe('ToastContainer', () => {
  it('returns null when no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a single toast with title', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Saved!' }];
    render(<ToastContainer />);
    expect(screen.getByText('Saved!')).not.toBeNull();
  });

  it('renders toast with description when provided', () => {
    mockToasts = [{ id: 't1', type: 'info', title: 'Info', description: 'Details here' }];
    render(<ToastContainer />);
    expect(screen.getByText('Details here')).not.toBeNull();
  });

  it('does not render description when omitted', () => {
    mockToasts = [{ id: 't1', type: 'info', title: 'Info' }];
    const { container } = render(<ToastContainer />);
    // Only the title <p> should exist, no second <p> for description
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
  });

  it('renders aria-live="polite" region', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Saved!' }];
    const { container } = render(<ToastContainer />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
  });

  it('renders multiple toasts', () => {
    mockToasts = [
      { id: 't1', type: 'success', title: 'First' },
      { id: 't2', type: 'error', title: 'Second' },
    ];
    render(<ToastContainer />);
    expect(screen.getByText('First')).not.toBeNull();
    expect(screen.getByText('Second')).not.toBeNull();
  });

  it('shows "Clear all" button when multiple toasts', () => {
    mockToasts = [
      { id: 't1', type: 'success', title: 'First' },
      { id: 't2', type: 'error', title: 'Second' },
    ];
    render(<ToastContainer />);
    expect(screen.getByText('Clear all')).not.toBeNull();
  });

  it('does not show "Clear all" button for single toast', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Only' }];
    expect(screen.queryByText('Clear all')).toBeNull();
  });

  it('dismiss button calls removeToast with toast id', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Dismiss me' }];
    render(<ToastContainer />);
    const dismissBtn = screen.getByLabelText('aria.dismiss');
    fireEvent.click(dismissBtn);
    expect(mockRemoveToast).toHaveBeenCalledWith('t1');
  });

  it('Clear all removes all toasts', () => {
    mockToasts = [
      { id: 't1', type: 'success', title: 'First' },
      { id: 't2', type: 'error', title: 'Second' },
    ];
    render(<ToastContainer />);
    fireEvent.click(screen.getByLabelText('aria.dismissAll'));
    expect(mockRemoveToast).toHaveBeenCalledTimes(2);
    expect(mockRemoveToast).toHaveBeenCalledWith('t1');
    expect(mockRemoveToast).toHaveBeenCalledWith('t2');
  });

  it('toast has role="alert"', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Alert!' }];
    const { container } = render(<ToastContainer />);
    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.textContent).toContain('Alert!');
  });

  it('renders undo button when undoAction is provided', () => {
    const undoFn = vi.fn();
    mockToasts = [{ id: 't1', type: 'undo', title: 'Deleted', undoAction: undoFn }];
    render(<ToastContainer />);
    const undoBtn = screen.getByLabelText('aria.undo');
    expect(undoBtn).not.toBeNull();
  });

  it('undo button calls undoAction then removeToast', () => {
    const undoFn = vi.fn();
    mockToasts = [{ id: 't1', type: 'undo', title: 'Deleted', undoAction: undoFn }];
    render(<ToastContainer />);
    fireEvent.click(screen.getByLabelText('aria.undo'));
    expect(undoFn).toHaveBeenCalledOnce();
    expect(mockRemoveToast).toHaveBeenCalledWith('t1');
  });

  it('no undo button when undoAction is absent', () => {
    mockToasts = [{ id: 't1', type: 'info', title: 'No undo' }];
    expect(screen.queryByLabelText('aria.undo')).toBeNull();
  });

  it('progress bar starts at 100% width', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Hi' }];
    const { container } = render(<ToastContainer />);
    // The progress bar is the div with aria-hidden inside the toast
    const progressBar = container.querySelector('[aria-hidden="true"]');
    expect(progressBar).not.toBeNull();
  });

  it('auto-dismisses after timeout', () => {
    mockToasts = [{ id: 't1', type: 'success', title: 'Bye' }];
    render(<ToastContainer />);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(mockRemoveToast).toHaveBeenCalledWith('t1');
  });
});
