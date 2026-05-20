import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import EmptyState from '../EmptyState';
import { AlertTriangle } from 'lucide-react';

describe('EmptyState', () => {
  it('renders title', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.textContent).toContain('Nothing here');
  });

  it('renders description when provided', () => {
    const { container } = render(<EmptyState title="Empty" description="No items found" />);
    expect(container.textContent).toContain('No items found');
  });

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders icon when provided', () => {
    const { container } = render(<EmptyState title="Error" icon={<AlertTriangle data-testid="icon" />} />);
    expect(container.querySelector('[data-testid="icon"]')).not.toBeNull();
  });

  it('does not render icon wrapper when no icon', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('div.rounded-full')).toBeNull();
  });

  it('renders action when provided', () => {
    const { container } = render(<EmptyState title="Empty" action={<button>Add item</button>} />);
    expect(container.querySelector('button')).not.toBeNull();
    expect(container.querySelector('button')!.textContent).toBe('Add item');
  });

  it('applies empty-error variant styles', () => {
    const { container } = render(<EmptyState variant="empty-error" title="Failed" />);
    const h3 = container.querySelector('h3');
    expect(h3).not.toBeNull();
    expect(h3!.className).toContain('text-red-300');
  });

  it('applies feature-unavailable variant styles', () => {
    const { container } = render(<EmptyState variant="feature-unavailable" title="Coming soon" />);
    const h3 = container.querySelector('h3');
    expect(h3!.className).toContain('text-amber-300');
  });

  it('has role="status" and aria-label', () => {
    const { container } = render(<EmptyState title="No data" />);
    const el = container.querySelector('[role="status"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-label')).toBe('No data');
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState title="Test" className="custom-class" />);
    expect((container.firstChild! as HTMLElement).className).toContain('custom-class');
  });
});
