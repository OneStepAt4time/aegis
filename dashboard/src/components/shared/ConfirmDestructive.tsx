import { useCallback, useEffect, useRef, useState } from 'react';

interface ConfirmDestructiveProps {
  mode: 'hold' | 'type';
  entityName?: string;
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}

function HoldConfirmButton({
  label,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const holdStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const HOLD_MS = 800;

  const startHold = useCallback(() => {
    if (disabled) return;
    holdStartRef.current = Date.now();
    setHolding(true);

    const tick = () => {
      if (holdStartRef.current === null) return;
      const elapsed = Date.now() - holdStartRef.current;
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(pct);
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setHolding(false);
        setProgress(0);
        holdStartRef.current = null;
        onConfirm();
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, onConfirm]);

  const cancelHold = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    holdStartRef.current = null;
    setHolding(false);
    setProgress(0);
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Hold to ${label}`}
      onMouseDown={startHold}
      onMouseUp={cancelHold}
      onMouseLeave={cancelHold}
      onTouchStart={startHold}
      onTouchEnd={cancelHold}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') startHold(); }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancelHold(); }}
      className={`relative min-h-[44px] overflow-hidden rounded border border-[var(--color-danger)]/30 bg-[var(--color-error-bg)]/20 px-3 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors select-none hover:bg-[var(--color-error-bg)]/35 disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 origin-left bg-[var(--color-danger)]/20 transition-none"
        style={{ transform: `scaleX(${progress / 100})` }}
      />
      <span className="relative">
        {holding ? `Hold… ${Math.round(progress)}%` : label}
      </span>
    </button>
  );
}

function TypeConfirmInput({
  label,
  entityName,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  entityName?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setOpen(true);
    setInputValue('');
  };

  const handleCancel = () => {
    setOpen(false);
    setInputValue('');
  };

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const matches = entityName ? inputValue === entityName : inputValue.length > 0;

  const handleConfirm = () => {
    if (!matches) return;
    setOpen(false);
    setInputValue('');
    onConfirm();
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        aria-label={label}
        className={`min-h-[44px] rounded border border-[var(--color-danger)]/30 bg-[var(--color-error-bg)]/20 px-3 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-error-bg)]/35 disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ''}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-[var(--color-text-muted)]">
        Type <span className="font-mono font-semibold">{entityName}</span> to confirm
      </p>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm();
            if (e.key === 'Escape') handleCancel();
          }}
          placeholder={entityName ?? 'Confirm…'}
          aria-label={`Type ${entityName ?? ''} to confirm`}
          className="min-h-[36px] w-40 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-danger)]/50 focus:outline-none"
        />
        <button
          type="button"
          disabled={!matches}
          onClick={handleConfirm}
          className="min-h-[36px] rounded border border-[var(--color-danger)]/30 bg-[var(--color-error-bg)]/20 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-error-bg)]/35 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="min-h-[36px] rounded border border-[var(--color-void-lighter)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ConfirmDestructive({
  mode,
  entityName,
  label,
  onConfirm,
  disabled,
  className,
}: ConfirmDestructiveProps) {
  if (mode === 'hold') {
    return (
      <HoldConfirmButton
        label={label}
        onConfirm={onConfirm}
        disabled={disabled}
        className={className}
      />
    );
  }
  return (
    <TypeConfirmInput
      label={label}
      entityName={entityName}
      onConfirm={onConfirm}
      disabled={disabled}
      className={className}
    />
  );
}
