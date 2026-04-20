/**
 * components/shared/StaggerList.tsx
 *
 * Orchestrated list entry — children stagger 40ms on mount using Framer Motion.
 * Wraps children in a motion container that applies sequential entrance animations.
 *
 * Usage:
 *   <StaggerList>
 *     <StaggerItem><Card /></StaggerItem>
 *     <StaggerItem><Card /></StaggerItem>
 *   </StaggerList>
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface StaggerListProps {
  children: ReactNode;
  className?: string;
  /** Stagger delay between items in seconds. Default: 0.04 (40ms) */
  staggerDelay?: number;
}

export function StaggerList({
  children,
  className,
  staggerDelay = 0.04,
}: StaggerListProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export default StaggerList;
