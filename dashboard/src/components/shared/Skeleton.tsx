/**
 * components/shared/Skeleton.tsx — Loading skeleton components.
 * Updated with brand-aware shimmer (CTA-tinted).
 */

interface SkeletonProps {
  className?: string;
}

export function SkeletonLine({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-shimmer rounded bg-[var(--color-surface)] ${className}`}
      aria-hidden="true"
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--color-surface) 0%, var(--color-surface-hover) 50%, var(--color-surface) 100%)',
        backgroundSize: '200% 100%',
      }}
    />
  );
}

export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4 ${className}`}>
      <div className="space-y-3">
        <SkeletonLine className="h-4 w-1/3" />
        <SkeletonLine className="h-3 w-2/3" />
        <SkeletonLine className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {/* Header */}
      <SkeletonLine className="h-8 w-full" />
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          <SkeletonLine className="h-4 w-1/4" />
          <SkeletonLine className="h-4 w-1/6" />
          <SkeletonLine className="h-4 w-1/6" />
          <SkeletonLine className="h-4 w-1/6" />
        </div>
      ))}
    </div>
  );
}


/** Matches the geometry of an overview stat card. */
export function SkeletonStatCard() {
  return (
    <div
      className="rounded-xl border border-[var(--color-void-lighter)]/60 bg-[var(--color-surface)] p-5 space-y-3"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between">
        <SkeletonLine className="h-3.5 w-24" />
        <SkeletonLine className="h-5 w-5 rounded" />
      </div>
      <SkeletonLine className="h-8 w-16" />
      <SkeletonLine className="h-2.5 w-32" />
    </div>
  );
}


