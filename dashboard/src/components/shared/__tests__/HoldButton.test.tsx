import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { HoldButton } from '../HoldButton';

describe('HoldButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children text', () => {
    render(<HoldButton onConfirm={vi.fn()}>Kill</HoldButton>);
    expect(screen.getByText('Kill')).not.toBeNull();
  });

  it('renders as a button element', () => {
    const { container } = render(<HoldButton onConfirm={vi.fn()}>Hold</HoldButton>);
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('does not fire onConfirm immediately on mousedown', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={vi.fn()}>Hold</HoldButton>);
    fireEvent.mouseDown(screen.getByRole('button'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires onConfirm after holdDuration elapses', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Hold</HoldButton>);
    fireEvent.mouseDown(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(850); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not fire onConfirm if released early', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Hold</HoldButton>);
    fireEvent.mouseDown(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.mouseUp(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels hold on mouseLeave', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Hold</HoldButton>);
    fireEvent.mouseDown(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.mouseLeave(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows progress ring while holding', () => {
    render(<HoldButton onConfirm={vi.fn()} holdDuration={800}>Hold</HoldButton>);
    const btn = screen.getByRole('button');
    // Before holding, no progress SVG
    expect(btn.querySelector('svg')).toBeNull();
    fireEvent.mouseDown(btn);
    act(() => { vi.advanceTimersByTime(100); });
    // While holding, progress SVG appears
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  it('applies disabled attribute', () => {
    const { container } = render(<HoldButton onConfirm={vi.fn()} disabled>Hold</HoldButton>);
    const btn = container.querySelector('button')!;
    expect(btn.disabled).toBe(true);
  });

  it('does not start hold when disabled', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} disabled holdDuration={800}>Hold</HoldButton>);
    fireEvent.mouseDown(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(900); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses default variant danger styling', () => {
    const { container } = render(<HoldButton onConfirm={vi.fn()} variant="danger">Hold</HoldButton>);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('class')).toContain('color-danger');
  });

  it('uses default variant styling when variant=default', () => {
    const { container } = render(<HoldButton onConfirm={vi.fn()} variant="default">Hold</HoldButton>);
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('class')).toContain('color-void-lighter');
  });

  it('passes extra HTML attributes to button', () => {
    const { container } = render(
      <HoldButton onConfirm={vi.fn()} aria-label="Hold to confirm">Hold</HoldButton>
    );
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe('Hold to confirm');
  });

  it('resets progress after successful hold', () => {
    const onConfirm = vi.fn();
    const { container } = render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Hold</HoldButton>);
    const btn = container.querySelector('button')!;
    fireEvent.mouseDown(btn);
    act(() => { vi.advanceTimersByTime(850); });
    expect(onConfirm).toHaveBeenCalled();
    // Progress ring should be gone
    expect(btn.querySelector('svg')).toBeNull();
  });
});
