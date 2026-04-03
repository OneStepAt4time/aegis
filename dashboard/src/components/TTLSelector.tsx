/**
 * components/TTLSelector.tsx — Time-to-live selector component.
 * 
 * Allows users to select session TTL with presets (15m, 1h, 4h, 8h) or custom duration.
 */

import { useState } from 'react';
import { Clock } from 'lucide-react';

interface TTLSelectorProps {
  /** Selected TTL in seconds. undefined = no TTL set. */
  value: number | undefined;
  /** Callback when TTL is changed. */
  onChange: (ttl: number | undefined) => void;
}

const TTL_PRESETS = [
  { label: '15m', seconds: 15 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '4h', seconds: 4 * 60 * 60 },
  { label: '8h', seconds: 8 * 60 * 60 },
] as const;

export function TTLSelector({ value, onChange }: TTLSelectorProps) {
  // Track whether we're in custom mode (value is not one of the presets)
  const isCustom = value !== undefined && !TTL_PRESETS.some(p => p.seconds === value);
  const [customInput, setCustomInput] = useState<string>(
    isCustom ? String(Math.floor((value ?? 0) / 60)) : ''
  );

  function handlePresetClick(seconds: number) {
    onChange(seconds);
    setCustomInput('');
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target.value;
    setCustomInput(input);
    
    if (!input.trim()) {
      onChange(undefined);
    } else {
      const minutes = parseInt(input, 10);
      if (!isNaN(minutes) && minutes > 0) {
        onChange(minutes * 60);
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-gray-500" />
        <label className="block text-xs font-medium text-gray-400">
          Session TTL <span className="text-gray-600">(optional)</span>
        </label>
      </div>

      {/* Preset buttons */}
      <div className="grid grid-cols-4 gap-2">
        {TTL_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => handlePresetClick(preset.seconds)}
            className={`py-2 px-2 text-xs rounded transition-colors border ${
              value === preset.seconds
                ? 'bg-[#00e5ff]/10 border-[#00e5ff] text-[#00e5ff]'
                : 'border-[#1a1a2e] text-gray-400 hover:text-gray-300 hover:border-[#2a2a3e]'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Custom input */}
      <div>
        <input
          type="number"
          value={customInput}
          onChange={handleCustomChange}
          placeholder="Custom minutes…"
          min="1"
          className="w-full min-h-[44px] px-3 py-2.5 text-sm bg-[#0a0a0f] border border-[#1a1a2e] rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-[#00e5ff]"
        />
        {customInput && !isNaN(parseInt(customInput, 10)) && (
          <p className="text-xs text-gray-500 mt-1">
            {formatDuration(parseInt(customInput, 10) * 60)}
          </p>
        )}
      </div>

      {/* Current value display */}
      {value !== undefined && (
        <p className="text-xs text-gray-500">
          TTL: {formatDuration(value)}
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
