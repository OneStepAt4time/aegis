/**
 * components/shared/IdleTip.tsx — Animated idle tip display with Framer Motion.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { Lightbulb } from 'lucide-react';

interface IdleTipProps {
  show: boolean;
  tip: string;
}

export function IdleTip({ show, tip }: IdleTipProps) {
  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          key={tip}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-accent-cyan)]/5 border border-[var(--color-accent-cyan)]/20 text-sm text-[var(--color-text-muted)]"
        >
          <Lightbulb className="h-4 w-4 text-[var(--color-accent-cyan)]" />
          <span>{tip}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
