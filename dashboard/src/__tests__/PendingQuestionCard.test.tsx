import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PendingQuestionCard } from '../components/session/PendingQuestionCard';

describe('PendingQuestionCard', () => {
  it('renders question copy and quick reply options', () => {
    const onSelectOption = vi.fn();

    render(
      <PendingQuestionCard
        pendingQuestion={{
          toolUseId: 'tool-1',
          content: 'What label should we use on mobile?',
          options: ['Ship it', 'Revise copy'],
          since: Date.now(),
        }}
        onSelectOption={onSelectOption}
      />,
    );

    expect(screen.getByText('What label should we use on mobile?')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Ship it' }));

    expect(onSelectOption).toHaveBeenCalledWith('Ship it');
  });
});
