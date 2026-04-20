/**
 * components/shared/AnimatedNumber.tsx
 *
 * Animated counter that tweens to new values using Framer Motion spring physics.
 * Optionally flashes an accent color when the value changes.
 *
 * Usage:
 *   <AnimatedNumber value={42} />
 *   <AnimatedNumber value={total} suffix="ms" flash />
 */

import { useEffect, useRef } from 'react';
import { useSpring, useTransform, motion, type SpringOptions } from 'framer-motion';

export interface AnimatedNumberProps {
  value: number;
  /** Optional suffix to append (e.g., "ms", "%") */
  suffix?: string;
  /** Flash accent color on value change. Default: false */
  flash?: boolean;
  /** Accent color for flash. Default: var(--color-accent) */
  flashColor?: string;
  /** CSS classes for the root element */
  className?: string;
  /** Number of decimal places. Default: 0 */
  decimals?: number;
}

const springConfig: SpringOptions = {
  stiffness: 100,
  damping: 30,
  mass: 1,
};

export function AnimatedNumber({
  value,
  suffix,
  flash = false,
  flashColor = 'var(--color-accent)',
  className,
  decimals = 0,
}: AnimatedNumberProps) {
  const spring = useSpring(value, springConfig);
  const display = useTransform(spring, (latest) =>
    latest.toFixed(decimals)
  );

  const prevValueRef = useRef(value);

  useEffect(() => {
    if (value !== prevValueRef.current) {
      spring.set(value);
      prevValueRef.current = value;
    }
  }, [value, spring]);

  return (
    <motion.span
      className={className}
      animate={
        flash && value !== prevValueRef.current
          ? {
              color: [flashColor, 'currentColor'],
              transition: {
                duration: 0.32,
                ease: [0.2, 0, 0, 1],
              },
            }
          : {}
      }
    >
      <motion.span>{display}</motion.span>
      {suffix}
    </motion.span>
  );
}

export default AnimatedNumber;
