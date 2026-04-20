/**
 * Framer Motion presets derived from `tokens.duration` + `tokens.easing`.
 *
 * Framer Motion takes durations in SECONDS (not ms) and easings as
 * 4-element cubic-bezier tuples `[x1, y1, x2, y2]` (not CSS strings).
 * This module does the conversion so components stay declarative:
 *
 *   <motion.div transition={motion.base} />
 */

import { tokens } from './tokens.js';

/** Framer easings as [x1, y1, x2, y2] tuples. */
export const framerEasing = {
  standard: [0.2, 0, 0, 1] as const,
  emphasisIn: [0.3, 0, 0.8, 0.15] as const,
  emphasisOut: [0.05, 0.7, 0.1, 1] as const,
  decelerate: [0, 0, 0.2, 1] as const,
  accelerate: [0.4, 0, 1, 1] as const,
} as const;

export type FramerEasing = typeof framerEasing[keyof typeof framerEasing];

/** ms → seconds helper. */
function ms(value: number): number {
  return value / 1000;
}

/**
 * Framer-ready transition presets.
 * Every preset uses the `standard` ease unless the name says otherwise.
 */
export const motion: {
  readonly instant: { readonly duration: number };
  readonly fast: { readonly duration: number; readonly ease: FramerEasing };
  readonly base: { readonly duration: number; readonly ease: FramerEasing };
  readonly slow: { readonly duration: number; readonly ease: FramerEasing };
  readonly cinematic: { readonly duration: number; readonly ease: FramerEasing };
  readonly enter: { readonly duration: number; readonly ease: FramerEasing };
  readonly exit: { readonly duration: number; readonly ease: FramerEasing };
} = {
  instant: { duration: ms(tokens.duration.instant) },
  fast: { duration: ms(tokens.duration.fast), ease: framerEasing.standard },
  base: { duration: ms(tokens.duration.base), ease: framerEasing.standard },
  slow: { duration: ms(tokens.duration.slow), ease: framerEasing.standard },
  cinematic: {
    duration: ms(tokens.duration.cinematic),
    ease: framerEasing.standard,
  },
  /** Enter animations (elements appearing). */
  enter: { duration: ms(tokens.duration.base), ease: framerEasing.emphasisOut },
  /** Exit animations (elements disappearing). */
  exit: { duration: ms(tokens.duration.fast), ease: framerEasing.emphasisIn },
} as const;

export type MotionPreset = keyof typeof motion;
