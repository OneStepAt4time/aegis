/**
 * AgentContributionsPanel.test.tsx — Tests for agent contributions panel.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentContributionsPanel } from '../AgentContributionsPanel';

describe('AgentContributionsPanel', () => {
  it('renders with mock data by default', () => {
    const { container } = render(<AgentContributionsPanel />);
    expect(container.querySelector('section')).toBeTruthy();
    expect(screen.getByText('Agent Contributions')).toBeTruthy();
  });

  it('renders empty state when data is empty array', () => {
    render(<AgentContributionsPanel data={[]} />);
    expect(screen.getByText(/No agent contribution data available yet/)).toBeTruthy();
  });

  it('renders loading state', () => {
    render(<AgentContributionsPanel loading />);
    expect(screen.getByText('Agent Contributions')).toBeTruthy();
  });

  it('renders with custom data', () => {
    const data = [
      { agent: 'Daedalus', commits: 10, additions: 500, deletions: 100, prs: 2, role: 'Frontend' },
      { agent: 'Hephaestus', commits: 20, additions: 1000, deletions: 300, prs: 3, role: 'Backend' },
    ];
    render(<AgentContributionsPanel data={data} />);
    expect(screen.getByText('Agent Contributions')).toBeTruthy();
    // Check summary KPIs
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('has correct aria-label', () => {
    render(<AgentContributionsPanel />);
    expect(screen.getByLabelText('Agent contributions panel')).toBeTruthy();
  });

  it('shows agent names in the list', () => {
    const data = [
      { agent: 'TestAgent', commits: 5, additions: 200, deletions: 50, prs: 1, role: 'Test' },
    ];
    render(<AgentContributionsPanel data={data} />);
    expect(screen.getByText(/TestAgent/)).toBeTruthy();
  });
});
