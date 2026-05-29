/**
 * SessionMetadataPanel tests — KV metadata display and editing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SessionMetadataPanel } from '../SessionMetadataPanel';

vi.mock('../../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

vi.mock('../../../api/session-metadata', () => ({
  fetchSessionMeta: vi.fn().mockResolvedValue({
    pr_number: '1234',
    github_issue: 'https://github.com/org/repo/issues/56',
    pipeline_status: 'running',
  }),
  setSessionMeta: vi.fn().mockImplementation((_id: string, pairs: Record<string, string>) => {
    return Promise.resolve({
      pr_number: '1234',
      github_issue: 'https://github.com/org/repo/issues/56',
      pipeline_status: 'running',
      ...pairs,
    });
  }),
  deleteSessionMetaKey: vi.fn().mockImplementation((_id: string, key: string) => {
    const base: Record<string, string> = {
      pr_number: '1234',
      github_issue: 'https://github.com/org/repo/issues/56',
      pipeline_status: 'running',
    };
    delete base[key];
    return Promise.resolve(base);
  }),
}));

describe('SessionMetadataPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders existing metadata entries', async () => {
    render(<SessionMetadataPanel sessionId="sess-1" />);
    expect(await screen.findByText('pr_number')).toBeDefined();
    expect(screen.getByText('1234')).toBeDefined();
    expect(screen.getByText('pipeline_status')).toBeDefined();
  });

  it('shows add form with key/value inputs', async () => {
    render(<SessionMetadataPanel sessionId="sess-1" />);
    await screen.findByText('pr_number');
    expect(screen.getByLabelText(/New metadata key/i)).toBeDefined();
    expect(screen.getByLabelText(/New metadata value/i)).toBeDefined();
  });

  it('calls setSessionMeta when adding a new key', async () => {
    render(<SessionMetadataPanel sessionId="sess-1" />);
    await screen.findByText('pr_number');

    const keyInput = screen.getByLabelText(/New metadata key/i);
    const valueInput = screen.getByLabelText(/New metadata value/i);

    fireEvent.change(keyInput, { target: { value: 'env' } });
    fireEvent.change(valueInput, { target: { value: 'production' } });
    fireEvent.click(screen.getByText('Add'));

    const { setSessionMeta } = await import('../../../api/session-metadata');
    await waitFor(() => {
      expect(setSessionMeta).toHaveBeenCalledWith('sess-1', { env: 'production' });
    });
  });

  it('shows empty state when no metadata', async () => {
    const { fetchSessionMeta } = await import('../../../api/session-metadata');
    (fetchSessionMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    render(<SessionMetadataPanel sessionId="sess-empty" />);
    expect(await screen.findByText(/No metadata set/i)).toBeDefined();
  });
});
