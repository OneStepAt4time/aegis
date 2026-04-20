/**
 * useViewTransitionNavigate — React Router navigate with View Transitions
 * Issue #009
 */

import { useNavigate, NavigateOptions } from 'react-router-dom';
import { useCallback } from 'react';
import { withViewTransition } from '../utils/viewTransitions';

/**
 * Drop-in replacement for useNavigate() that wraps navigation in View Transitions.
 */
export function useViewTransitionNavigate() {
  const navigate = useNavigate();

  const viewTransitionNavigate = useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (typeof to === 'number') {
        // Numeric navigation (go(-1), go(1), etc.) — wrap in view transition
        withViewTransition(() => navigate(to));
      } else {
        // String path navigation
        withViewTransition(() => navigate(to, options));
      }
    },
    [navigate]
  );

  return viewTransitionNavigate;
}
