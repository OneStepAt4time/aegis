/**
 * components/routines/CalendarGrid.tsx — Monthly calendar grid for the Routines page.
 *
 * Displays a month view with clickable days. Days with scheduled routines
 * are highlighted. Navigation between months via prev/next buttons.
 */

import { useMemo, useCallback, useState } from 'react';

// Native Date utilities — replaces date-fns (#2934)
function format(d: Date, fmt: string): string {
  const map: Record<string, string> = {
    'yyyy': String(d.getFullYear()),
    'MM': String(d.getMonth() + 1).padStart(2, '0'),
    'dd': String(d.getDate()).padStart(2, '0'),
    'MMM': d.toLocaleString('en', { month: 'short' }),
  };
  return fmt.replace(/yyyy|MMM|MM|dd/g, (m) => map[m] ?? m);
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d: Date, opts?: { weekStartsOn?: number }): Date { const start = opts?.weekStartsOn ?? 0; const day = d.getDay(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((day - start + 7) % 7)); }
function endOfWeek(d: Date, opts?: { weekStartsOn?: number }): Date { const start = opts?.weekStartsOn ?? 0; const day = d.getDay(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + ((start + 6 - day + 7) % 7)); }
function eachDayOfInterval({ start, end }: { start: Date; end: Date }): Date[] {
  const days: Date[] = [];
  const current = new Date(start); current.setHours(0, 0, 0, 0);
  const last = new Date(end); last.setHours(0, 0, 0, 0);
  while (current <= last) { days.push(new Date(current)); current.setDate(current.getDate() + 1); }
  return days;
}
function isSameMonth(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
function isSameDay(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isToday(d: Date): boolean { return isSameDay(d, new Date()); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); }
function subMonths(d: Date, n: number): Date { return addMonths(d, -n); }

import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface RoutineSchedule {
  id: string;
  title: string;
  cronSchedule: string;
  nextRunAt: string;
  status: 'active' | 'paused';
}

interface CalendarGridProps {
  routines: RoutineSchedule[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  className?: string;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function CalendarGrid({
  routines,
  selectedDate,
  onSelectDate,
  className = '',
}: CalendarGridProps) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [currentMonth]);

  // Build a map of dates that have routines scheduled
  const routineDates = useMemo(() => {
    const map = new Map<string, RoutineSchedule[]>();
    for (const r of routines) {
      const key = format(new Date(r.nextRunAt), 'yyyy-MM-dd');
      const existing = map.get(key) ?? [];
      existing.push(r);
      map.set(key, existing);
    }
    return map;
  }, [routines]);

  const handlePrevMonth = useCallback(() => {
    setCurrentMonth((prev) => subMonths(prev, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setCurrentMonth((prev) => addMonths(prev, 1));
  }, []);

  const handleToday = useCallback(() => {
    setCurrentMonth(new Date());
  }, []);

  return (
    <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {format(currentMonth, 'MMMM yyyy')}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleToday}
            className="px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors rounded"
            aria-label="Go to today"
          >
            Today
          </button>
          <button
            onClick={handlePrevMonth}
            className="p-1 rounded hover:bg-[var(--color-void-dark)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNextMonth}
            className="p-1 rounded hover:bg-[var(--color-void-dark)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-[var(--color-border)]" role="row">
        {WEEKDAY_LABELS.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-xs font-medium text-[var(--color-text-muted)]"
            role="columnheader"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7" role="grid" aria-label="Calendar">
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayRoutines = routineDates.get(dateKey);
          const hasRoutines = dayRoutines && dayRoutines.length > 0;
          const inCurrentMonth = isSameMonth(day, currentMonth);
          const isSelected = selectedDate && isSameDay(day, selectedDate);
          const today = isToday(day);

          return (
            <button
              key={dateKey}
              onClick={() => onSelectDate(day)}
              disabled={!inCurrentMonth}
              className={`
                relative p-2 min-h-[4rem] text-left transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset
                ${!inCurrentMonth ? 'opacity-30 cursor-default' : 'hover:bg-[var(--color-void-dark)] cursor-pointer'}
                ${isSelected ? 'bg-blue-500/10 ring-1 ring-blue-500/30' : ''}
              `}
              aria-label={`${format(day, 'EEEE, MMMM d, yyyy')}${hasRoutines ? `, ${dayRoutines.length} routine${dayRoutines.length > 1 ? 's' : ''}` : ''}`}
              aria-current={today ? 'date' : undefined}
            >
              <span
                className={`
                  text-sm font-medium
                  ${today ? 'text-blue-400' : inCurrentMonth ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}
                `}
              >
                {format(day, 'd')}
              </span>
              {hasRoutines && (
                <div className="mt-1 flex flex-col gap-0.5">
                  {dayRoutines.slice(0, 2).map((r) => (
                    <span
                      key={r.id}
                      className={`
                        text-[10px] leading-tight truncate px-1 py-0.5 rounded
                        ${r.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}
                      `}
                    >
                      {r.title}
                    </span>
                  ))}
                  {dayRoutines.length > 2 && (
                    <span className="text-[10px] text-[var(--color-text-muted)] px-1">
                      +{dayRoutines.length - 2} more
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
