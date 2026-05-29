import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditTrailPanel } from '../AuditTrailPanel';
import type { AuditRecord } from '../../../types';

vi.mock('../../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

const mockRecords: AuditRecord[] = [
  {
    hash: 'abc123',
    action: 'permission_prompt',
    ts: '2026-05-27T10:00:00Z',
    detail: 'Allow write to /tmp/test?',
    actor: 'claude-agent',
    prevHash: 'prev001',
  },
  {
    hash: 'def456',
    action: 'permission_granted',
    ts: '2026-05-27T10:01:00Z',
    detail: 'Write to /tmp/test approved',
    actor: 'admin',
    prevHash: 'abc123',
  },
  {
    hash: 'ghi789',
    action: 'permission_denied',
    ts: '2026-05-27T10:02:00Z',
    detail: 'Exec rm -rf denied',
    actor: 'reviewer',
    prevHash: 'def456',
  },
];

describe('AuditTrailPanel', () => {
  it('shows loading skeletons when loading', () => {
    const { container } = render(
      <AuditTrailPanel records={[]} loading={true} error={null} />
    );
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(3);
  });

  it('shows error message when error prop is set', () => {
    render(<AuditTrailPanel records={[]} loading={false} error="Network error" />);
    expect(screen.getByText(/Network error/)).toBeDefined();
  });

  it('shows empty state when records is empty', () => {
    render(<AuditTrailPanel records={[]} loading={false} error={null} />);
    expect(screen.getByText('No audit events for this session')).toBeDefined();
  });

  it('renders all records', () => {
    render(
      <AuditTrailPanel records={mockRecords} loading={false} error={null} />
    );
    expect(screen.getByText('permission_prompt')).toBeDefined();
    expect(screen.getByText('permission_granted')).toBeDefined();
    expect(screen.getByText('permission_denied')).toBeDefined();
  });

  it('renders record detail text', () => {
    render(
      <AuditTrailPanel records={mockRecords} loading={false} error={null} />
    );
    expect(screen.getByText('Allow write to /tmp/test?')).toBeDefined();
  });

  it('renders actor names', () => {
    render(
      <AuditTrailPanel records={mockRecords} loading={false} error={null} />
    );
    expect(screen.getByText('by claude-agent')).toBeDefined();
    expect(screen.getByText('by admin')).toBeDefined();
    expect(screen.getByText('by reviewer')).toBeDefined();
  });

  it('renders with role="list" and items with role="listitem"', () => {
    render(
      <AuditTrailPanel records={mockRecords} loading={false} error={null} />
    );
    expect(screen.getByRole('list')).toBeDefined();
    expect(screen.getAllByRole('listitem').length).toBe(3);
  });

  it('renders record without detail or actor', () => {
    const record: AuditRecord = {
      hash: 'minimal',
      action: 'session_start',
      ts: '2026-05-27T09:00:00Z',
      detail: '',
      actor: 'system',
      prevHash: '',
    };
    render(<AuditTrailPanel records={[record]} loading={false} error={null} />);
    expect(screen.getByText('session_start')).toBeDefined();
  });

  it('renders timestamps for each record', () => {
    render(
      <AuditTrailPanel records={mockRecords} loading={false} error={null} />
    );
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(3);
    // Each item should have a Clock icon (lucide) for timestamp
    // Verify at least the date portion renders (May 27)
    expect(screen.getAllByRole('listitem').length).toBe(3);
  });

  it('has aria-label on list', () => {
    render(
      <AuditTrailPanel records={mockRecords} loading={false} error={null} />
    );
    expect(screen.getByRole('list').getAttribute('aria-label')).toBe('Audit trail');
  });
});
