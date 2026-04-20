import { useCallback, useRef, useState } from 'react';
import { Icon } from '../Icon';

export interface FilterToken {
  field: 'status' | 'date' | 'owner' | 'text';
  op: 'eq' | 'gte' | 'lte' | 'contains';
  value: string;
  display: string;
}

const STATUS_MAP: Record<string, string> = {
  failed: 'error',
  error: 'error',
  errors: 'error',
  active: 'active',
  running: 'active',
  alive: 'active',
  working: 'working',
  idle: 'idle',
  killed: 'killed',
  dead: 'killed',
  unknown: 'unknown',
};

const STATUS_DISPLAY: Record<string, string> = {
  error: 'status: error',
  active: 'status: active',
  working: 'status: working',
  idle: 'status: idle',
  killed: 'status: killed',
  unknown: 'status: unknown',
};

function startOfDay(offset = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parseNLQuery(input: string): FilterToken[] {
  const tokens: FilterToken[] = [];
  const lower = input.toLowerCase().trim();
  let remaining = lower;

  const datePatterns: Array<[RegExp, () => FilterToken[]]> = [
    [/\bfrom\s+yesterday\b/, () => [{
      field: 'date', op: 'gte', value: startOfDay(-1).toISOString(),
      display: 'from yesterday'
    }]],
    [/\btoday\b/, () => [{
      field: 'date', op: 'gte', value: startOfDay().toISOString(),
      display: 'today'
    }]],
    [/\byesterday\b/, () => [{
      field: 'date', op: 'gte', value: startOfDay(-1).toISOString(),
      display: 'yesterday'
    }, {
      field: 'date', op: 'lte', value: startOfDay(0).toISOString(),
      display: ''
    }]],
    [/\blast\s+week\b/, () => [{
      field: 'date', op: 'gte', value: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
      display: 'last week'
    }]],
    [/\bthis\s+week\b/, () => [{
      field: 'date', op: 'gte', value: startOfWeek().toISOString(),
      display: 'this week'
    }]],
    [/\bthis\s+month\b/, () => [{
      field: 'date', op: 'gte', value: startOfMonth().toISOString(),
      display: 'this month'
    }]],
    [/\blast\s+month\b/, () => {
      const start = new Date(); start.setMonth(start.getMonth() - 1); start.setDate(1); start.setHours(0,0,0,0);
      const end = new Date(); end.setDate(1); end.setHours(0,0,0,0);
      return [{
        field: 'date', op: 'gte', value: start.toISOString(), display: 'last month'
      }, {
        field: 'date', op: 'lte', value: end.toISOString(), display: ''
      }];
    }],
    [/\blast\s+30\s*days?\b/, () => [{
      field: 'date', op: 'gte', value: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
      display: 'last 30 days'
    }]],
    [/\blast\s+7\s*days?\b/, () => [{
      field: 'date', op: 'gte', value: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
      display: 'last 7 days'
    }]],
    [/\blast\s+24\s*hours?\b/, () => [{
      field: 'date', op: 'gte', value: new Date(Date.now() - 24 * 3600_000).toISOString(),
      display: 'last 24h'
    }]],
    [/\blast\s+hour\b/, () => [{
      field: 'date', op: 'gte', value: new Date(Date.now() - 3600_000).toISOString(),
      display: 'last hour'
    }]],
  ];

  for (const [pattern, factory] of datePatterns) {
    if (pattern.test(remaining)) {
      const produced = factory();
      for (const t of produced) {
        tokens.push(t);
      }
      remaining = remaining.replace(pattern, '').trim();
    }
  }

  const ownerMatch = remaining.match(/\b(?:by|owner|owned by)\s+(\S+)/i);
  if (ownerMatch) {
    const ownerVal = ownerMatch[1];
    tokens.push({
      field: 'owner', op: 'contains', value: ownerVal,
      display: `by: ${ownerVal}`
    });
    remaining = remaining.replace(ownerMatch[0], '').trim();
  }

  const words = remaining.split(/[\s,]+/).filter(Boolean);
  const textWords: string[] = [];
  for (const word of words) {
    const statusVal = STATUS_MAP[word.toLowerCase()];
    if (statusVal && !tokens.some((t) => t.field === 'status' && t.value === statusVal)) {
      tokens.push({
        field: 'status', op: 'eq', value: statusVal,
        display: STATUS_DISPLAY[statusVal] ?? `status: ${statusVal}`
      });
    } else if (!['sessions', 'session', 'and', 'or', 'the', 'a', 'an'].includes(word.toLowerCase())) {
      textWords.push(word);
    }
  }

  const textRaw = textWords.join(' ').trim();
  if (textRaw) {
    tokens.push({
      field: 'text', op: 'contains', value: textRaw,
      display: `"${textRaw}"`
    });
  }

  return tokens.filter((t) => t.display !== '');
}

interface NLFilterBarProps {
  onFilter: (tokens: FilterToken[], raw: string) => void;
  placeholder?: string;
  className?: string;
}

export function NLFilterBar({ onFilter, placeholder = 'Filter: "active sessions today", "by admin last week"…', className }: NLFilterBarProps) {
  const [inputValue, setInputValue] = useState('');
  const [chips, setChips] = useState<FilterToken[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitInput = useCallback(() => {
    const raw = inputValue.trim();
    if (!raw) return;
    const parsed = parseNLQuery(raw);
    const next = [...chips, ...parsed];
    setChips(next);
    setInputValue('');
    onFilter(next, next.map((t) => t.display).join(', '));
  }, [inputValue, chips, onFilter]);

  const removeChip = useCallback((index: number) => {
    const next = chips.filter((_, i) => i !== index);
    setChips(next);
    onFilter(next, next.map((t) => t.display).join(', '));
  }, [chips, onFilter]);

  const clearAll = useCallback(() => {
    setChips([]);
    setInputValue('');
    onFilter([], '');
    inputRef.current?.focus();
  }, [onFilter]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && inputValue === '' && chips.length > 0) {
      removeChip(chips.length - 1);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2 focus-within:border-[var(--color-accent-cyan)]/50 ${className ?? ''}`}>
      {chips.map((chip, i) => (
        <span
          key={`${chip.field}-${chip.value}-${i}`}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-2 py-0.5 text-xs text-[var(--color-accent-cyan)]"
        >
          {chip.display}
          <button
            type="button"
            onClick={() => removeChip(i)}
            aria-label={`Remove filter ${chip.display}`}
            className="ml-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
          >
            <Icon name="X" size={12} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (inputValue.trim()) commitInput(); }}
        placeholder={chips.length === 0 ? placeholder : 'Add filter…'}
        className="min-w-[200px] flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
        aria-label="Natural language filter"
      />
      {(chips.length > 0 || inputValue) && (
        <button
          type="button"
          onClick={clearAll}
          aria-label="Clear all filters"
          className="ml-1 rounded p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          <Icon name="X" size={16} />
        </button>
      )}
    </div>
  );
}
