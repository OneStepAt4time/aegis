/**
 * pages/RoutinesPage.tsx — Scheduled tasks / routines with calendar-style view.
 *
 * Phase 1 scaffold: Calendar UI with empty states.
 * Backend API endpoints for routines will be added in Phase 2.
 *
 * Related: #2908 // token-ok
 */

import { useState, useCallback } from 'react';
import { Calendar, Plus } from 'lucide-react';
import EmptyState from '../components/shared/EmptyState';
import { CalendarGrid } from '../components/routines';
import RoutineCard from '../components/routines/RoutineCard';
import type { RoutineSchedule } from '../components/routines/CalendarGrid';

export default function RoutinesPage() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Phase 1: No backend yet — routines will come from API in Phase 2
  const routines: RoutineSchedule[] = [];
  const loading = false;

  const handleTogglePause = useCallback((_id: string) => {
    // Phase 2: Call API to pause/resume
  }, []);

  const handleTriggerNow = useCallback((_id: string) => {
    // Phase 2: Call API to trigger immediate run
  }, []);

  const handleDelete = useCallback((_id: string) => {
    // Phase 2: Call API to delete routine
  }, []);

  const handleCreate = useCallback(() => {
    // Phase 2: Open create routine modal
  }, []);

  // Calendar + content (shared between empty and populated states)
  const calendarContent = (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar takes 2 columns */}
      <div className="lg:col-span-2">
        <CalendarGrid
          routines={routines}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </div>

      {/* Sidebar: routines list */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {selectedDate ? `Routines for selected date` : 'Upcoming'}
        </h2>
        {routines.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-8 h-8" />}
            title="No routines yet"
            description="Create a routine to schedule recurring tasks on a calendar."
          />
        ) : (
          routines.map((routine) => (
            <RoutineCard
              key={routine.id}
              routine={routine}
              onTogglePause={handleTogglePause}
              onTriggerNow={handleTriggerNow}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );

  if (!loading && routines.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Routines</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Scheduled tasks that run on a recurring basis
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
            aria-label="Create new routine"
          >
            <Plus className="w-4 h-4" />
            New Routine
          </button>
        </div>
        {calendarContent}
      </div>
    );
  }

  // Populated state
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Routines</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {routines.length} scheduled task{routines.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[var(--color-bg)]"
          aria-label="Create new routine"
        >
          <Plus className="w-4 h-4" />
          New Routine
        </button>
      </div>
      {calendarContent}
    </div>
  );
}
