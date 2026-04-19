/**
 * components/brand/ShieldLogo.tsx
 *
 * Aegis shield logo system. Exports:
 * - ShieldLogoMark: Shield icon only
 * - ShieldWordmark: Shield + "Aegis" text
 *
 * All sizes and colors use design tokens.
 */

export type ShieldLogoSize = 'sm' | 'md' | 'lg' | 'xl';

interface ShieldLogoMarkProps {
  size?: ShieldLogoSize;
  className?: string;
}

interface ShieldWordmarkProps {
  size?: ShieldLogoSize;
  className?: string;
  collapsed?: boolean;
}

const SIZE_MAP = {
  sm: { h: 16, w: 16, text: 'text-sm' },
  md: { h: 24, w: 24, text: 'text-lg' },
  lg: { h: 32, w: 32, text: 'text-xl' },
  xl: { h: 48, w: 48, text: 'text-2xl' },
};

/**
 * ShieldLogoMark — Shield icon only, with subtle vertical gradient
 */
export function ShieldLogoMark({ size = 'md', className = '' }: ShieldLogoMarkProps) {
  const { h, w } = SIZE_MAP[size];
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="shield-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="var(--color-cta-bg)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--color-success)" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.5L3.5 6v6c0 5.25 3.5 10.15 8.5 12 5-1.85 8.5-6.75 8.5-12V6L12 2.5z"
        fill="url(#shield-gradient)"
      />
      <path
        d="M12 2.5L3.5 6v6c0 5.25 3.5 10.15 8.5 12 5-1.85 8.5-6.75 8.5-12V6L12 2.5z"
        fill="var(--color-cta-bg)"
        fillOpacity="0.2"
      />
    </svg>
  );
}

/**
 * ShieldWordmark — Shield + "Aegis" text side-by-side
 */
export function ShieldWordmark({ size = 'md', className = '', collapsed = false }: ShieldWordmarkProps) {
  const { text } = SIZE_MAP[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <ShieldLogoMark size={size} className="shrink-0 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
      {!collapsed && (
        <span
          className={`${text} font-bold tracking-tight whitespace-nowrap`}
          style={{ color: 'var(--color-brand)' }}
        >
          Aegis
        </span>
      )}
    </div>
  );
}
