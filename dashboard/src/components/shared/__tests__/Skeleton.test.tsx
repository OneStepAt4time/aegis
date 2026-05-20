import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SkeletonLine, SkeletonCard, SkeletonTable, SkeletonStatCard } from '../Skeleton';

describe('SkeletonLine', () => {
  it('renders with shimmer class', () => {
    const { container } = render(<SkeletonLine />);
    expect((container.firstChild! as HTMLElement).className).toContain('animate-shimmer');
  });

  it('applies custom className', () => {
    const { container } = render(<SkeletonLine className="h-4 w-32" />);
    expect((container.firstChild! as HTMLElement).className).toContain('h-4');
  });

  it('has aria-hidden', () => {
    const { container } = render(<SkeletonLine />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('SkeletonCard', () => {
  it('renders with border and padding', () => {
    const { container } = render(<SkeletonCard />);
    expect((container.firstChild! as HTMLElement).className).toContain('rounded-lg');
    expect((container.firstChild! as HTMLElement).className).toContain('p-4');
  });

  it('contains skeleton lines inside', () => {
    const { container } = render(<SkeletonCard />);
    expect(container.querySelectorAll('.animate-shimmer').length).toBe(3);
  });
});

describe('SkeletonTable', () => {
  it('renders by default with rows', () => {
    const { container } = render(<SkeletonTable />);
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(0);
  });

  it('accepts custom rows prop without crashing', () => {
    const { container } = render(<SkeletonTable rows={2} />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('SkeletonStatCard', () => {
  it('renders with card geometry', () => {
    const { container } = render(<SkeletonStatCard />);
    expect((container.firstChild! as HTMLElement).className).toContain('rounded-xl');
    expect((container.firstChild! as HTMLElement).className).toContain('p-5');
  });

  it('has aria-hidden', () => {
    const { container } = render(<SkeletonStatCard />);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
