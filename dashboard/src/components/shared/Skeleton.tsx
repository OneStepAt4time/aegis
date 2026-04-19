/**
 * components/shared/Skeleton.tsx — Loading skeleton components.
 */

interface SkeletonProps {
  className?: string;
}

export function SkeletonLine({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--color-void-lighter)] ${className}`}
      aria-hidden="true"
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

/** Matches the geometry of a session table row. */
export function SkeletonSessionRow() {
  return (
    <div className="flex items-center gap-4 border-b border-[var(--color-void-lighter)]/40 px-4 py-3" aria-hidden="true">
      {/* Status dot */}
      <SkeletonLine className="h-2 w-2 rounded-full shrink-0" />
      {/* Session ID */}
      <SkeletonLine className="h-3.5 w-28" />
      {/* Work dir */}
      <SkeletonLine className="h-3.5 w-40 hidden sm:block" />
      {/* Status badge */}
      <SkeletonLine className="h-5 w-16 rounded-full" />
      {/* Time */}
      <SkeletonLine className="h-3 w-20 ml-auto hidden md:block" />
      {/* Actions */}
      <SkeletonLine className="h-6 w-6 rounded shrink-0" />
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

/** Matches the geometry of a session detail page header. */
export function SkeletonSessionDetailHeader() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {/* Title row */}
      <div className="flex items-center gap-3">
        <SkeletonLine className="h-6 w-6 rounded shrink-0" />
        <SkeletonLine className="h-5 w-48" />
        <SkeletonLine className="h-5 w-16 rounded-full ml-2" />
      </div>
      {/* Meta row */}
      <div className="flex flex-wrap gap-4">
        <SkeletonLine className="h-3.5 w-36" />
        <SkeletonLine className="h-3.5 w-28" />
        <SkeletonLine className="h-3.5 w-24" />
      </div>
      {/* Action buttons */}
      <div className="flex gap-2">
        <SkeletonLine className="h-8 w-20 rounded-lg" />
        <SkeletonLine className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  );
}

