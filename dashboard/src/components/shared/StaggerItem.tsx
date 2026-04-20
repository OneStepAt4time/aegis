/**
 * components/shared/StaggerItem.tsx
 *
 * Individual item for use inside <StaggerList>. Applies fade-in + slide-up
 * animation using motion tokens.
 *
 * Usage:
 *   <StaggerList>
 *     <StaggerItem><Card /></StaggerItem>
 *   </StaggerList>
 */

import { motion } from 'framer-motion';
import { motion as motionPresets } from '../../design/motion.js';
import type { ReactNode } from 'react';

export interface StaggerItemProps {
  children: ReactNode;
  className?: string;
}

export function StaggerItem({ children, className }: StaggerItemProps) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: {
          opacity: 0,
          y: 20,
        },
        visible: {
          opacity: 1,
          y: 0,
          transition: motionPresets.enter,
        },
      }}
    >
      {children}
    </motion.div>
  );
}

export default StaggerItem;
