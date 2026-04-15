/**
 * hooks/useSessionListShortcuts.ts — Keyboard shortcuts for session list navigation.
 * Arrow up/down to navigate, Enter to open, Delete to kill, N for new session.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { killSession } from '../api/client';
import { useToastStore } from '../store/useToastStore';

interface UseSessionListShortcutsOptions {
  sessionIds: string[];
  onDelete?: (id: string) => void | Promise<void>;
  enabled?: boolean;
}

export function useSessionListShortcuts({
  sessionIds,
  onDelete,
  enabled = true,
}: UseSessionListShortcutsOptions) {
  const navigate = useNavigate();
  const addToast = useToastStore((t) => t.addToast);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  // Reset focused index when session list changes
  useEffect(() => {
    if (sessionIds.length === 0) {
      setFocusedIndex(-1);
    } else if (focusedIndex >= sessionIds.length) {
      setFocusedIndex(sessionIds.length - 1);
    }
  }, [sessionIds.length, focusedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isInput) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev < sessionIds.length - 1 ? prev + 1 : prev
          );
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        }
        case 'Enter': {
          if (focusedIndex >= 0 && focusedIndex < sessionIds.length) {
            e.preventDefault();
            navigate(`/sessions/${encodeURIComponent(sessionIds[focusedIndex])}`);
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (focusedIndex >= 0 && focusedIndex < sessionIds.length) {
            e.preventDefault();
            const id = sessionIds[focusedIndex];
            if (window.confirm(`Kill session ${id}?`)) {
              killSession(id)
                .then(() => {
                  addToast('success', 'Session killed', id);
                  onDelete?.(id);
                })
                .catch(() => {
                  addToast('error', 'Kill failed', id);
                });
            }
          }
          break;
        }
        case 'n': {
          e.preventDefault();
          navigate('/sessions/new');
          break;
        }
      }
    },
    [enabled, focusedIndex, sessionIds, navigate, addToast, onDelete]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { focusedIndex, setFocusedIndex };
}
