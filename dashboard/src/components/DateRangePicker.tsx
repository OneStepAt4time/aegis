/**
 * components/DateRangePicker.tsx — Time range selector for metrics and audit pages.
 *
 * Presets: 1h, 24h, 7d, 30d, custom.
 * Emits { from: ISO string, to: ISO string } on change.
 */

import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, X } from 'lucide-react';

const PRESETS = [
  { label: '1h',  fromOffsetMs: 60 * 60 * 1000 },
  { label: '24h', fromOffsetMs: 24 * 60 * 60 * 1000 },
  { label: '7d',  fromOffsetMs: 7 * 24 * 60 * 60 * 1000 },
  { label: '30d', fromOffsetMs: 30 * 24 * 60 * 60 * 1000 },
] as const;

export interface DateRange {
  from: string; // ISO string
  to: string;   // ISO string
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

export default function DateRangePicker({
  value,
  onChange,
  className = '',
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from.slice(0, 16));
  const [customTo, setCustomTo] = useState(value.to.slice(0, 16));
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function selectPreset(label: string) {
    const preset = PRESETS.find((p) => p.label === label);
    if (!preset) return;
    const to = new Date();
    const from = new Date(to.getTime() - preset.fromOffsetMs);
    onChange({ from: from.toISOString(), to: to.toISOString() });
    setOpen(false);
  }

  function applyCustom() {
    const fromDate = new Date(customFrom);
    const toDate = new Date(customTo);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return;
    if (fromDate > toDate) return;
    onChange({ from: fromDate.toISOString(), to: toDate.toISOString() });
    setOpen(false);
  }

  function isPresetActive(presetLabel: string): boolean {
    const preset = PRESETS.find((p) => p.label === presetLabel);
    if (!preset) return false;
    const now = Date.now();
    const fromMs = now - preset.fromOffsetMs;
    const toMs = now;
    const valFromMs = new Date(value.from).getTime();
    const valToMs = new Date(value.to).getTime();
    return Math.abs(fromMs - valFromMs) < 60_000 && Math.abs(toMs - valToMs) < 60_000;
  }

  const activePreset = PRESETS.find((p) => isPresetActive(p.label))?.label ?? 'custom';

  return (
    <div ref={dropdownRef} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select time range"
        className="inline-flex min-h-[36px] items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/40 hover:text-[var(--color-accent-cyan)]"
      >
        <Calendar className="h-3.5 w-3.5 text-gray-500" />
        <span>{activePreset === 'custom' ? 'Custom' : activePreset}</span>
        <ChevronDown className={`h-3 w-3 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Time range presets"
          className="absolute z-50 mt-1 min-w-[220px] rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-2 shadow-xl shadow-black/40"
        >
          {/* Presets */}
          <div className="flex gap-1 mb-2" role="group" aria-label="Preset ranges">
            {PRESETS.map(({ label }) => (
              <button
                key={label}
                role="option"
                aria-selected={isPresetActive(label)}
                type="button"
                onClick={() => selectPreset(label)}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                  isPresetActive(label)
                    ? 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)] border border-[var(--color-accent-cyan)]/40'
                    : 'text-gray-400 hover:bg-[var(--color-void-lighter)] hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="my-2 border-t border-[var(--color-void-lighter)]" />

          {/* Custom range */}
          <div className="space-y-2" role="group" aria-label="Custom range">
            <div className="flex items-center gap-2">
              <label htmlFor="drp-from" className="text-xs text-gray-500 w-8">From</label>
              <input
                id="drp-from"
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="flex-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-2 py-1 text-xs text-gray-200 outline-none focus:border-[var(--color-accent-cyan)]/60"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="drp-to" className="text-xs text-gray-500 w-8">To</label>
              <input
                id="drp-to"
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="flex-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-2 py-1 text-xs text-gray-200 outline-none focus:border-[var(--color-accent-cyan)]/60"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyCustom}
                className="flex-1 rounded bg-[var(--color-accent-cyan)]/20 border border-[var(--color-accent-cyan)]/40 px-2 py-1.5 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/30"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex items-center justify-center rounded border border-[var(--color-void-lighter)] px-1.5 py-1.5 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
