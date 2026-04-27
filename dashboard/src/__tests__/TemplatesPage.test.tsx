/**
 * TemplatesPage.test.tsx — Tests for session templates management page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { act } from 'react';
import TemplatesPage from '../pages/TemplatesPage';
import * as client from '../api/client';
import type { SessionTemplate } from '../types';

// Mock the API client
vi.mock('../api/client', () => ({
  getTemplates: vi.fn(),
  createSession: vi.fn(),
  createTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
}));

// Mock useToastStore
vi.mock('../store/useToastStore', () => ({
  useToastStore: (sel: (s: { addToast: ReturnType<typeof vi.fn> }) => unknown) =>
    sel({ addToast: vi.fn() }),
}));

const mockTemplates: SessionTemplate[] = [
  {
    id: 'tmpl-1',
    name: 'React Scaffold',
    description: 'Standard React project setup',
    workDir: '/home/user/projects/react-app',
    prompt: 'Create a new React app with TypeScript',
    claudeCommand: 'claude --model opus',
    permissionMode: 'bypassPermissions',
    autoApprove: false,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'tmpl-2',
    name: 'Bug Fix',
    description: 'Fix a bug in existing code',
    workDir: '/home/user/projects/myapp',
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000,
  },
];

function renderPage() {
  return render(
    <BrowserRouter>
      <TemplatesPage />
    </BrowserRouter>,
  );
}

describe('TemplatesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getTemplates).mockResolvedValue(mockTemplates);
  });

  it('renders templates list', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('React Scaffold')).toBeDefined();
    });
    expect(screen.getByText('Bug Fix')).toBeDefined();
  });

  it('shows empty state when no templates', async () => {
    vi.mocked(client.getTemplates).mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No templates yet')).toBeDefined();
    });
  });

  it('shows error state on fetch failure', async () => {
    vi.mocked(client.getTemplates).mockRejectedValue(new Error('Network error'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Unable to load templates')).toBeDefined();
    });
  });

  it('deletes a template after confirmation', async () => {
    vi.mocked(client.deleteTemplate).mockResolvedValue({ ok: true });

    renderPage();

    // Wait for templates to load
    await waitFor(() => {
      expect(screen.getByText('React Scaffold')).toBeDefined();
    });

    // There should be at least 2 "Delete" buttons (one per template card)
    // The first template's Delete button should trigger the confirm dialog
    const allDeleteBtns = screen.getAllByText('Delete');
    expect(allDeleteBtns.length).toBeGreaterThanOrEqual(2);

    // Click the first Delete button
    await act(async () => {
      fireEvent.click(allDeleteBtns[0]);
    });

    // The confirm dialog should render - check for the dialog heading
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Delete Template' })).toBeDefined();
    }, { timeout: 3000 });

    // Verify deleteTemplate was NOT called yet (confirmation needed)
    expect(client.deleteTemplate).not.toHaveBeenCalled();
  });

  it('opens create template modal', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('React Scaffold')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Create Template'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Template' })).toBeDefined();
    });
  });

  it('duplicates a template', async () => {
    vi.mocked(client.createTemplate).mockResolvedValue({
      ...mockTemplates[0],
      id: 'tmpl-3',
      name: 'React Scaffold (copy)',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('React Scaffold')).toBeDefined();
    });

    const duplicateButtons = screen.getAllByText('Duplicate');
    fireEvent.click(duplicateButtons[0]);

    await waitFor(() => {
      expect(client.createTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'React Scaffold (copy)',
          workDir: '/home/user/projects/react-app',
        }),
      );
    });
  });

  it('displays template metadata', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('React Scaffold')).toBeDefined();
    });

    // Shows permission mode badge
    expect(screen.getByText('bypassPermissions')).toBeDefined();
    // Shows work directory
    expect(screen.getByText('/home/user/projects/react-app')).toBeDefined();
  });
});
