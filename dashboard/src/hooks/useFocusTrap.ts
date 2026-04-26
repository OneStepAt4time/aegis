/**
 * hooks/useFocusTrap.ts — Focus trap hook for modal/dialog accessibility.
 *
 * Traps Tab/Shift+Tab within a container element. Restores focus to the
 * previously-focused element on unmount. Meets WCAG 2.1 focus management
 * requirements for modal dialogs.
 */

import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null,
  );
}

function isFocusable(el: HTMLElement): boolean {
  return el.matches(FOCUSABLE_SELECTOR) && !el.hasAttribute('aria-hidden') && el.offsetParent !== null;
}

export function useFocusTrap(
  isActive: boolean,
  options: {
    /** Restore focus to this element on deactivate (default: previously focused element) */
    restoreFocusRef?: React.RefObject<HTMLElement | null>;
    /** Auto-focus the first focusable element on activate */
    autoFocus?: boolean;
  } = {},
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !containerRef.current) return;

      const focusable = getFocusableElements(containerRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab: wrap from first to last
        if (active === first || !containerRef.current.contains(active as Node)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: wrap from last to first
        if (active === last || !containerRef.current.contains(active as Node)) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!isActive) return;

    // Save currently focused element
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    // Auto-focus first focusable element
    if (options.autoFocus !== false && containerRef.current) {
      const focusable = getFocusableElements(containerRef.current);
      if (focusable.length > 0) {
        // Use requestAnimationFrame to ensure DOM is painted
        requestAnimationFrame(() => {
          focusable[0].focus();
        });
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);

      // Restore focus
      const restoreTarget = options.restoreFocusRef?.current ?? previouslyFocusedRef.current;
      if (restoreTarget && isFocusable(restoreTarget)) {
        requestAnimationFrame(() => {
          restoreTarget.focus();
        });
      }
    };
  }, [isActive, handleKeyDown, options.autoFocus, options.restoreFocusRef]);

  return containerRef;
}
