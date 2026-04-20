import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface RingGaugeProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  primaryColor?: string;
  trackColor?: string;
  label?: string;
}

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
    // Slight delay before filling ring for a nice load effect
    const timeout = setTimeout(() => {
      setAnimatedValue(Math.max(0, Math.min(100, value)));
    }, 100);
    return () => clearTimeout(timeout);
  }, [value]);

  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (animatedValue / 100) * circumference;

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90 origin-center drop-shadow-[0_0_15px_rgba(6,182,212,0.2)]"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          className="transition-colors duration-300"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={primaryColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 1.5, ease: 'easeOut', type: 'spring', bounce: 0.2 }}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
        <span className="font-mono text-3xl font-bold tracking-tighter" style={{ color: primaryColor }}>
          {value}%
        </span>
        {label && <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider mt-1">{label}</span>}
      </div>
    </div>
  );
}
