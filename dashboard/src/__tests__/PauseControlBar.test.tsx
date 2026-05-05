/**
 * __tests__/PauseControlBar.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PauseControlBar } from '../components/session/PauseControlBar';

describe('PauseControlBar', () => {
  it('renders pause button when session is running', () => {
    render(<PauseControlBar sessionStatus="running" />);
    expect(screen.getByLabelText('Pause session')).toBeDefined();
  });

  it('renders pause button when session is idle', () => {
    render(<PauseControlBar sessionStatus="idle" />);
    expect(screen.getByLabelText('Pause session')).toBeDefined();
  });

  it('shows pause form when pause button is clicked', async () => {
    render(<PauseControlBar sessionStatus="running" />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Pause session'));
    });
    expect(screen.getByLabelText('Reason for pausing')).toBeDefined();
    expect(screen.getByLabelText('Confirm pause')).toBeDefined();
  });

  it('calls onPause with reason when confirmed', async () => {
    const onPause = vi.fn().mockResolvedValue(undefined);
    render(<PauseControlBar sessionStatus="running" onPause={onPause} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Pause session'));
    });

    const input = screen.getByLabelText('Reason for pausing');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'security review' } });
      fireEvent.click(screen.getByLabelText('Confirm pause'));
    });

    expect(onPause).toHaveBeenCalledWith('security review');
  });

  it('shows intervene and resume buttons when paused', () => {
    render(<PauseControlBar sessionStatus="running" interventionStatus="paused" />);
    expect(screen.getByLabelText('Start intervention')).toBeDefined();
    expect(screen.getByLabelText('Resume session')).toBeDefined();
  });

  it('shows paused status badge when interventionStatus is paused', () => {
    render(<PauseControlBar sessionStatus="paused" interventionStatus="paused" />);
    expect(screen.getByText('Paused')).toBeDefined();
  });

  it('shows intervening status and complete button', () => {
    render(<PauseControlBar sessionStatus="paused" interventionStatus="intervening" />);
    expect(screen.getByText('Intervening')).toBeDefined();
    expect(screen.getByLabelText('Complete intervention with guidance')).toBeDefined();
  });

  it('shows guidance form when complete button is clicked', async () => {
    render(<PauseControlBar sessionStatus="paused" interventionStatus="intervening" />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Complete intervention with guidance'));
    });
    expect(screen.getByLabelText('Guidance for the agent (optional)')).toBeDefined();
  });

  it('calls onCompleteIntervention with guidance when submitted', async () => {
    const onCompleteIntervention = vi.fn().mockResolvedValue(undefined);
    render(
      <PauseControlBar
        sessionStatus="paused"
        interventionStatus="intervening"
        onCompleteIntervention={onCompleteIntervention}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Complete intervention with guidance'));
    });

    const textarea = screen.getByLabelText('Guidance for the agent (optional)');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Fix the typo' } });
      fireEvent.click(screen.getByLabelText('Submit guidance and complete intervention'));
    });

    expect(onCompleteIntervention).toHaveBeenCalledWith('Fix the typo');
  });

  it('calls onIntervene when intervene button is clicked', async () => {
    const onIntervene = vi.fn().mockResolvedValue(undefined);
    render(
      <PauseControlBar
        sessionStatus="paused"
        interventionStatus="paused"
        onIntervene={onIntervene}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Start intervention'));
    });
    expect(onIntervene).toHaveBeenCalled();
  });

  it('calls onResume when resume button is clicked', async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    render(
      <PauseControlBar
        sessionStatus="paused"
        interventionStatus="paused"
        onResume={onResume}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Resume session'));
    });
    expect(onResume).toHaveBeenCalled();
  });

  it('displays error and clear button', () => {
    const onClearError = vi.fn();
    render(
      <PauseControlBar
        sessionStatus="running"
        error="Something went wrong"
        onClearError={onClearError}
      />
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByLabelText('Dismiss error')).toBeDefined();
  });

  it('clears error when dismiss button is clicked', async () => {
    const onClearError = vi.fn();
    render(
      <PauseControlBar
        sessionStatus="running"
        error="Something went wrong"
        onClearError={onClearError}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss error'));
    });
    expect(onClearError).toHaveBeenCalled();
  });

  it('disables buttons when loading', () => {
    render(
      <PauseControlBar
        sessionStatus="running"
        isLoading={true}
        onPause={vi.fn()}
      />
    );

    // The pause button should have the disabled attribute
    const btn = screen.getByLabelText('Pause session');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('has toolbar role with accessible label', () => {
    render(<PauseControlBar sessionStatus="running" />);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Session pause and intervention controls');
  });

  it('cancels pause form when cancel button clicked', async () => {
    render(<PauseControlBar sessionStatus="running" />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Pause session'));
    });
    const input = screen.getByLabelText('Reason for pausing');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.click(screen.getByLabelText('Cancel pause'));
    });
    expect(screen.queryByLabelText('Reason for pausing')).toBeNull();
  });
});
