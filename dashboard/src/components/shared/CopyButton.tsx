import { useEffect, useRef } from 'react';
import { Icon } from '../Icon';
import { useCopy } from '../../hooks/useCopy';

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: 16 | 20;
  className?: string;
}

export function CopyButton({ value, label, size = 16, className }: CopyButtonProps) {
  const { copied, copy } = useCopy(value, label);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'c' && document.activeElement === el) {
        e.preventDefault();
        copy();
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [copy]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={copy}
      className={`opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] ${className ?? ''}`}
      aria-label={`Copy ${label ?? ''}`}
      title={copied ? 'Copied!' : 'Copy'}
    >
      <Icon
        name={copied ? 'Check' : 'Copy'}
        size={size}
        className={copied ? 'text-[var(--color-success)]' : undefined}
      />
    </button>
  );
}
