/**
 * utils/tourState.ts — Tour completion state (sync, no component imports).
 */

const TOUR_COMPLETED_KEY = 'aegis:tour:completed';

export function isTourCompleted(): boolean {
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourCompleted(): void {
  try {
    localStorage.setItem(TOUR_COMPLETED_KEY, '1');
    sessionStorage.setItem(TOUR_COMPLETED_KEY, '1');
  } catch {
    // Ignore storage errors
  }
}
