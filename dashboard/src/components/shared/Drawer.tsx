/**
 * components/shared/Drawer.tsx — Reusable slide-in drawer.
 *
 * Extracted from NewSessionDrawer + AuditPage to eliminate duplicate
 * backdrop/panel/animation patterns (Issue #3657) // token-ok.
 *
 * Uses framer-motion AnimatePresence for enter/exit animations.
 * Supports focus trapping via an optional ref callback.
 */

import { AnimatePresence, type MotionProps } from 'framer-motion';
import { motion } from 'framer-motion';
import type { ReactNode, Ref } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface DrawerProps {
  /** Whether the drawer is open. */
  open: boolean;
  /** Called when the drawer should close (backdrop click, escape, etc.). */
  onClose: () => void;
  /** Drawer content. */
  children: ReactNode;
  /** Accessible label for the drawer dialog. */
  ariaLabel: string;
  /** Optional ref for focus trapping. */
  panelRef?: Ref<HTMLDivElement>;
  /** Additional className for the panel. */
  className?: string;
}

const backdropMotion: MotionProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

const panelMotion: MotionProps = {
  initial: { x: '100%' },
  animate: { x: 0 },
  exit: { x: '100%' },
  transition: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] },
};

export function Drawer({
  open,
  onClose,
  children,
  ariaLabel,

  className = '',
}: DrawerProps) {
  const trapRef = useFocusTrap(open);
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            {...backdropMotion}
            className="fixed inset-0 z-[var(--z-drawer-overlay)] bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.aside
            key="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            ref={trapRef}
            {...panelMotion}
            className={`fixed right-0 top-0 bottom-0 z-[var(--z-drawer)] w-full md:w-[480px] overflow-y-auto border-l border-[var(--color-overlay-border)] bg-[var(--color-surface)] shadow-2xl flex flex-col ${className}`}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
