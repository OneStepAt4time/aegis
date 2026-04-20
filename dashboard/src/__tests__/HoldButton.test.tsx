import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HoldButton } from '../components/shared/HoldButton';

describe('HoldButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders its children', () => {
    render(<HoldButton onConfirm={() => {}}>Kill Session</HoldButton>);
    expect(screen.getByText('Kill Session')).toBeDefined();
  });

  it('renders as a button', () => {
    render(<HoldButton onConfirm={() => {}}>Kill</HoldButton>);
    expect(screen.getByRole('button', { name: 'Kill' })).toBeDefined();
  });

  it('does not fire onConfirm on a single click (no hold)', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm}>Kill</HoldButton>);
    const btn = screen.getByRole('button', { name: 'Kill' });

    fireEvent.mouseDown(btn);
    fireEvent.mouseUp(btn);

    vi.runAllTimers();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires onConfirm after holding for 800ms', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Kill</HoldButton>);
    const btn = screen.getByRole('button', { name: 'Kill' });

    fireEvent.mouseDown(btn);

    act(() => { vi.advanceTimersByTime(850); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire onConfirm when released before 800ms', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Kill</HoldButton>);
    const btn = screen.getByRole('button', { name: 'Kill' });

    fireEvent.mouseDown(btn);
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.mouseUp(btn);

    act(() => { vi.advanceTimersByTime(500); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('cancels when mouse leaves before 800ms', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800}>Kill</HoldButton>);
    const btn = screen.getByRole('button', { name: 'Kill' });

    fireEvent.mouseDown(btn);
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.mouseLeave(btn);

    act(() => { vi.advanceTimersByTime(500); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('respects custom holdDuration', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={400}>Kill</HoldButton>);
    const btn = screen.getByRole('button', { name: 'Kill' });

    fireEvent.mouseDown(btn);
    act(() => { vi.advanceTimersByTime(450); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onConfirm = vi.fn();
    render(<HoldButton onConfirm={onConfirm} holdDuration={800} disabled>Kill</HoldButton>);
    const btn = screen.getByRole('button', { name: 'Kill' });

    fireEvent.mouseDown(btn);
    act(() => { vi.advanceTimersByTime(900); });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accepts aria-label', () => {
    render(
      <HoldButton onConfirm={() => {}} aria-label="Hold to kill session">
        Kill
      </HoldButton>,
    );
    expect(screen.getByRole('button', { name: 'Hold to kill session' })).toBeDefined();
  });
});
