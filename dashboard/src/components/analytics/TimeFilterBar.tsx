/**
 * components/analytics/TimeFilterBar.tsx — Time range filter for analytics pages.
 *
 * Preset buttons compute `from`/`to` ISO strings.
 * State syncs to URL search params for shareable views.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, CalendarDays, CalendarRange, Infinity } from 'lucide-react';

export interface TimeRange {
  from: string | null;
  to: string | null;
}

interface TimeFilterBarProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
  className?: string;
}

const PRESETS = [
  { label: '1h', icon: Clock, compute: () => ({ from: hoursAgo(1), to: now() }) },
  { label: '12h', icon: Clock, compute: () => ({ from: hoursAgo(12), to: now() }) },
  { label: 'Today', icon: CalendarDays, compute: () => ({ from: startOfDay(), to: now() }) },
  { label: 'Last week', icon: CalendarRange, compute: () => ({ from: daysAgo(7), to: now() }) },
  { label: 'Last month', icon: CalendarRange, compute: () => ({ from: daysAgo(30), to: now() }) },
  { label: 'All', icon: Infinity, compute: () => ({ from: null, to: null }) },
] as const;

function now(): string {
  return new Date().toISOString();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

function startOfDay(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function TimeFilterBar({ value, onChange, className = '' }: TimeFilterBarProps) {
  const [activePreset, setActivePreset] = useState<string | null>(() => {
    if (!value.from && !value.to) return 'All';
    const from = value.from ? new Date(value.from).getTime() : 0;
    const diff = Date.now() - from;
    if (diff <= 1.5 * 60 * 60 * 1000) return '1h';
    if (diff <= 13 * 60 * 60 * 1000) return '12h';
    if (diff <= 25 * 60 * 60 * 1000) return 'Today';
    if (diff <= 8 * 24 * 60 * 60 * 1000) return 'Last week';
    if (diff <= 32 * 24 * 60 * 60 * 1000) return 'Last month';
    return null;
  });

  // Sync from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    const to = params.get('to');
    if (from || to) {
      onChange({ from, to });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync to URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (value.from) params.set('from', value.from);
    else params.delete('from');
    if (value.to) params.set('to', value.to);
    else params.delete('to');
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    window.history.replaceState(null, '', newUrl);
  }, [value.from, value.to]);

  const handlePreset = useCallback(
    (label: string, compute: () => TimeRange) => {
      const range = compute();
      setActivePreset(label);
      onChange(range);
    },
    [onChange],
  );

  const presets = useMemo(() => PRESETS, []);

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className}`}
      role="toolbar"
      aria-label="Time range filter"
    >
      {presets.map(({ label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => handlePreset(label, presets.find((p) => p.label === label)!.compute)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
            activePreset === label
              ? 'border-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]'
              : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent-cyan)]/40 hover:text-[var(--color-text-primary)]'
          }`}
          aria-pressed={activePreset === label}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
