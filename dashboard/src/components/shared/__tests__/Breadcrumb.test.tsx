import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Breadcrumb from '../Breadcrumb';

function renderWithRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumb />
    </MemoryRouter>,
  );
}

describe('Breadcrumb', () => {
  it('returns null on root path', () => {
    const { container } = renderWithRoute('/');
    expect(container.innerHTML).toBe('');
  });

  it('renders breadcrumb for /sessions', () => {
    renderWithRoute('/sessions');
    expect(screen.getByText('Sessions')).not.toBeNull();
  });

  it('renders breadcrumb for /sessions/:id with truncated param', () => {
    renderWithRoute('/sessions/abc12345-6789-def0-1234-567890123456');
    expect(screen.getByText('abc12345…')).not.toBeNull();
  });

  it('renders Home as first crumb with link to /', () => {
    renderWithRoute('/sessions');
    const homeLink = screen.getByRole('link', { name: 'Home' });
    expect(homeLink.getAttribute('href')).toBe('/');
  });

  it('last crumb is plain text, not a link', () => {
    renderWithRoute('/sessions');
    const lastCrumb = screen.getByText('Sessions');
    expect(lastCrumb.closest('a')).toBeNull();
  });

  it('intermediate crumbs are links', () => {
    renderWithRoute('/sessions/abc12345-6789-def0-1234-567890123456');
    const sessionsLink = screen.getByRole('link', { name: 'Sessions' });
    expect(sessionsLink).not.toBeNull();
    const paramCrumb = screen.getByText('abc12345…');
    expect(paramCrumb.closest('a')).toBeNull();
  });

  it('renders nav element with aria-label', () => {
    renderWithRoute('/sessions');
    expect(screen.getByRole('navigation')).not.toBeNull();
  });

  it('renders Home icon for first crumb', () => {
    const { container } = renderWithRoute('/sessions');
    // Home icon is an SVG from lucide
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
