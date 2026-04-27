/**
 * components/shared/RingGauge.tsx
 * SVG circular gauge with gradient stroke, glow, and spring animation (#2014).
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { tokens } from '../../design/tokens';

interface RingGaugeProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  primaryColor?: string;
  trackColor?: string;
  label?: string;
}

const springConfig = tokens.glamour.gaugeSpring;
const gradientId = tokens.glamour.gaugeGradientId;
const glowId = tokens.glamour.gaugeGlowId;
const glowBlur = tokens.glamour.gaugeGlowBlur;

export function RingGauge({
  value,
  size = 120,
  strokeWidth = 10,
  primaryColor = 'var(--color-accent-cyan)',
  trackColor = 'rgba(255,255,255,0.05)',
  label
}: RingGaugeProps) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setAnimatedValue(Math.max(0, Math.min(100, value)));
    }, 100);
    return () => clearTimeout(timeout);
  }, [value]);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (animatedValue / 100) * circumference;
  const center = size / 2;

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90 origin-center"
      >
        <defs>
          {/* Gradient stroke */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--color-accent-cyan)" />
            <stop offset="100%" stopColor="var(--color-accent-purple)" />
          </linearGradient>
          {/* Glow filter */}
          <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={glowBlur / 4} result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.024
                      0 0 0 0 0.714
                      0 0 0 0 0.831
                      0 0 0 0.6 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          className="transition-colors duration-300"
        />

        {/* Animated arc */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{
            type: 'spring',
            stiffness: springConfig.stiffness,
            damping: springConfig.damping,
            mass: springConfig.mass,
          }}
          strokeLinecap="round"
          filter={`url(#${glowId})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
        <motion.span
          className="font-mono text-3xl font-bold tracking-tighter"
          style={{ color: primaryColor }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
        >
          {value}%
        </motion.span>
        {label && (
          <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider mt-1">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
