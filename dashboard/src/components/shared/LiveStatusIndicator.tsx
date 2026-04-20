/**
 * components/shared/LiveStatusIndicator.tsx — SSE connection status badge.
 */

import { useStore } from '../../store/useStore';

export default function LiveStatusIndicator() {
  const sseConnected = useStore((s) => s.sseConnected);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        sseConnected
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
          : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
      }`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {sseConnected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${sseConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
      </span>
      {sseConnected ? 'Live' : 'Polling'}
    </span>
  );
}
