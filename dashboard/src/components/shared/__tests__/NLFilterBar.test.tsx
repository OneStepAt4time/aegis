import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NLFilterBar, parseNLQuery } from '../NLFilterBar';

vi.mock('../../Icon', () => ({
  Icon: ({ name, size }: { name: string; size?: number }) => (
    <span data-testid={`icon-${name}`} data-size={size}>X</span>
  ),
}));

vi.mock('../../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

describe('parseNLQuery', () => {
  it('parses status keywords', () => {
    const tokens = parseNLQuery('active sessions');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status', value: 'active' }),
      ])
    );
  });

  it('parses "today" as date gte', () => {
    const tokens = parseNLQuery('today');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'date', op: 'gte', display: 'today' }),
      ])
    );
  });

  it('parses "yesterday" as date range', () => {
    const tokens = parseNLQuery('yesterday');
    const dateTokens = tokens.filter((t) => t.field === 'date');
    expect(dateTokens.length).toBeGreaterThanOrEqual(1);
    expect(dateTokens[0].op).toBe('gte');
  });

  it('parses "last week"', () => {
    const tokens = parseNLQuery('last week');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'date', display: 'last week' }),
      ])
    );
  });

  it('parses "this month"', () => {
    const tokens = parseNLQuery('sessions this month');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'date', display: 'this month' }),
      ])
    );
  });

  it('parses "by ownername"', () => {
    const tokens = parseNLQuery('by alice');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'owner', value: 'alice', display: 'by: alice' }),
      ])
    );
  });

  it('parses free text', () => {
    const tokens = parseNLQuery('myproject');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'text', value: 'myproject' }),
      ])
    );
  });

  it('parses complex query with status + date + owner', () => {
    const tokens = parseNLQuery('active sessions by admin last week');
    const fields = tokens.map((t) => t.field);
    expect(fields).toContain('status');
    expect(fields).toContain('date');
    expect(fields).toContain('owner');
  });

  it('returns empty for empty input', () => {
    const tokens = parseNLQuery('');
    expect(tokens).toEqual([]);
  });

  it('maps error/failed to error status', () => {
    const tokens = parseNLQuery('failed');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status', value: 'error' }),
      ])
    );
  });

  it('maps running to active status', () => {
    const tokens = parseNLQuery('running');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status', value: 'active' }),
      ])
    );
  });

  it('parses "last 7 days"', () => {
    const tokens = parseNLQuery('last 7 days');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'date', display: 'last 7 days' }),
      ])
    );
  });

  it('parses "last 24 hours"', () => {
    const tokens = parseNLQuery('last 24 hours');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'date', display: 'last 24h' }),
      ])
    );
  });
});

describe('NLFilterBar', () => {
  const onFilter = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with placeholder', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    expect(screen.getByLabelText('aria.naturalLanguageFilter')).toBeDefined();
  });

  it('commits filter on Enter', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onFilter).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ field: 'status', value: 'active' }),
      ]),
      expect.any(String)
    );
  });

  it('commits filter on comma', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onFilter).toHaveBeenCalled();
  });

  it('does not commit filter on blur (removed auto-commit)', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'today' } });
    fireEvent.blur(input);
    expect(onFilter).not.toHaveBeenCalled();
  });

  it('does not commit on blur when input is empty', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.blur(input);
    expect(onFilter).not.toHaveBeenCalled();
  });

  it('displays chips after commit', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('status: active')).toBeDefined();
  });

  it('removes chip on chip button click', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Find remove button for the chip
    const removeBtn = screen.getByLabelText('Remove filter status: active');
    fireEvent.click(removeBtn);
    expect(onFilter).toHaveBeenCalledWith([], '');
  });

  it('removes last chip on Backspace with empty input', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Now input is empty, backspace should remove last chip
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onFilter).toHaveBeenCalledWith([], '');
  });

  it('shows clear all button when chips exist', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('aria.clearAllFilters')).toBeDefined();
  });

  it('clears all chips on clear button click', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByLabelText('aria.clearAllFilters'));
    expect(onFilter).toHaveBeenCalledWith([], '');
  });

  it('uses custom placeholder', () => {
    render(<NLFilterBar onFilter={onFilter} placeholder="Custom placeholder" />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    expect(input.getAttribute('placeholder')).toBe('Custom placeholder');
  });

  it('switches placeholder to "Add filter…" after first chip', () => {
    render(<NLFilterBar onFilter={onFilter} />);
    const input = screen.getByLabelText('aria.naturalLanguageFilter');
    fireEvent.change(input, { target: { value: 'active' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('placeholder')).toBe('Add filter…');
  });
});
