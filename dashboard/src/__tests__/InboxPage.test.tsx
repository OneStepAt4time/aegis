/**
 * @jest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { InboxPage } from '../pages/InboxPage';
import { useInboxStore } from '../store/useInboxStore';

vi.mock('../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

const mockInboxItems = [
  {
    id: '1',
    workspaceId: 'ws1',
    userId: 'u1',
    actorType: 'agent' as const,
    actorId: 'agent-1',
    type: 'task_completed' as const,
    title: 'Task completed: Build dashboard',
    body: 'Session completed successfully',
    referenceType: 'session' as const,
    referenceId: 'sess-1',
    readAt: undefined,
    archivedAt: undefined,
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    workspaceId: 'ws1',
    userId: 'u1',
    actorType: 'system' as const,
    actorId: 'system',
    type: 'task_failed' as const,
    title: 'Task failed: Deploy pipeline',
    body: 'Error: connection refused',
    readAt: new Date().toISOString(),
    archivedAt: undefined,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

function renderInboxPage() {
  return render(
    <BrowserRouter>
      <InboxPage />
    </BrowserRouter>,
  );
}

describe('InboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxStore.setState({
      items: mockInboxItems,
      unreadCount: 1,
      filter: 'all',
      isLoading: false,
      error: null,
    });
  });

  it('renders inbox title and unread badge', async () => {
    renderInboxPage();
    expect(await screen.findByText('inbox.title')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
  });

  it('displays inbox items', async () => {
    renderInboxPage();
    expect(await screen.findByText('Task completed: Build dashboard')).toBeDefined();
    expect(screen.getByText('Task failed: Deploy pipeline')).toBeDefined();
  });

  it('shows unread dot for unread items', async () => {
    renderInboxPage();
    await screen.findByText('Task completed: Build dashboard');
    // Unread item has aria-label containing "unread"
    const unreadBtn = screen.getByLabelText(/Task completed.*unread/);
    expect(unreadBtn).toBeDefined();
  });

  it('marks item as read on click', async () => {
    renderInboxPage();
    const item = await screen.findByText('Task completed: Build dashboard');
    fireEvent.click(item.closest('button')!);
    expect(useInboxStore.getState().items.find((entry) => entry.id === '1')?.readAt).toBeDefined();
  });

  it('renders empty state when no items', async () => {
    useInboxStore.setState({
      items: [],
      unreadCount: 0,
    });
    renderInboxPage();
    expect(await screen.findByText('inbox.empty')).toBeDefined();
  });

  it('marks all read on button click', async () => {
    renderInboxPage();
    const markAllBtn = await screen.findByLabelText('inbox.markAllRead');
    fireEvent.click(markAllBtn);
    expect(useInboxStore.getState().unreadCount).toBe(0);
  });
});
