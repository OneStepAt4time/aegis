/**
 * hooks/useOptimistic.ts — Optimistic UI pattern hook.
 *
 * Provides instant visual feedback for mutations, then confirms or rolls
 * back with a toast on success/failure.
 *
 * Usage:
 *   const { execute, isPending } = useOptimistic(
 *     async () => await revokeAuthKey(id),
 *     {
 *       optimisticUpdate: () => setKeys(ks => ks.filter(k => k.id !== id)),
 *       rollback: () => setKeys(original),
 *       successMessage: 'Key revoked',
 *       errorMessage: 'Failed to revoke key',
 *     }
 *   );
 */

import { useCallback, useRef, useState } from 'react';
import { useToastStore } from '../store/useToastStore';

export interface UseOptimisticOptions<T> {
  /** Called immediately before the async action — apply the optimistic state change here. */
  optimisticUpdate?: () => void;
  /** Called when the action fails — restore the original state here. */
  rollback?: () => void;
  /** Toast message on success. If omitted, no success toast is shown. */
  successMessage?: string;
  /** Toast message on failure. Defaults to 'Something went wrong'. */
  errorMessage?: string;
  /** Called after a successful action with the result value. */
  onSuccess?: (result: T) => void;
  /** Called after a failed action with the error. */
  onError?: (err: unknown) => void;
}

export interface UseOptimisticReturn<T> {
  execute: () => Promise<T | undefined>;
  isPending: boolean;
}

export function useOptimistic<T>(
  action: () => Promise<T>,
  options: UseOptimisticOptions<T> = {},
): UseOptimisticReturn<T> {
  const [isPending, setIsPending] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const pendingRef = useRef(false);

  const execute = useCallback(async (): Promise<T | undefined> => {
    if (pendingRef.current) return undefined;
    pendingRef.current = true;
    setIsPending(true);

    options.optimisticUpdate?.();

    try {
      const result = await action();

      if (options.successMessage) {
        addToast('success', options.successMessage);
      }
      options.onSuccess?.(result);
      return result;
    } catch (err) {
      options.rollback?.();
      addToast('error', options.errorMessage ?? 'Something went wrong');
      options.onError?.(err);
      return undefined;
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  }, [action, options, addToast]);

  return { execute, isPending };
}
