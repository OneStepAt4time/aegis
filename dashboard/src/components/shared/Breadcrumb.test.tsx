/**
 * Breadcrumb tests — navigation breadcrumb trail.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Breadcrumb from './Breadcrumb';

vi.mock('../../i18n/context', async () => {
  const { testT } = await import('../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

function renderWithPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumb />
    </MemoryRouter>,
  );
}

describe('Breadcrumb', () => {
  it('renders nothing on root path', () => {
    const { container } = renderWithPath('/');
    expect(container.firstChild).toBeNull();
  });

  it('renders breadcrumb for /sessions', () => {
    renderWithPath('/sessions');
    expect(screen.getByText('Sessions')).not.toBeNull();
    expect(screen.getByText('Home')).not.toBeNull();
  });

  it('renders breadcrumb for nested route with UUID param', () => {
    renderWithPath('/sessions/abc12345-def6-7890-abcd-ef1234567890');
    expect(screen.getByText('Sessions')).not.toBeNull();
    // UUID param should be truncated
    const truncated = screen.getByText(/abc12345…/);
    expect(truncated).not.toBeNull();
  });

  it('has nav with aria-label', () => {
    renderWithPath('/audit');
    const nav = screen.getByRole('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
  });

  it('last crumb is plain text (no link)', () => {
    renderWithPath('/pipelines');
    const links = screen.getAllByRole('link');
    // "Pipelines" is the last crumb and should not be a link
    const pipelines = screen.getByText('Pipelines');
    expect(pipelines.closest('a')).toBeNull();
    // At least Home should be a link
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Home text on first crumb', () => {
    renderWithPath('/users');
    expect(screen.getByText('Home')).not.toBeNull();
  });
});
