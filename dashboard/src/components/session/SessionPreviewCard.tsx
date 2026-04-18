/**
 * components/session/SessionPreviewCard.tsx — Hover preview card for session rows.
 * Shows the last few transcript messages without leaving the list.
 */

import { useEffect, useState, useRef } from 'react';
import { getSessionMessages } from '../../api/client';
import type { ParsedEntry } from '../../types';
import type { SessionInfo } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from '../overview/StatusDot';

interface SessionPreviewCardProps {
  session: SessionInfo;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

const PREVIEW_MESSAGE_COUNT = 4;

function MessagePreview({ msg }: { msg: ParsedEntry }) {
  const text = msg.text.slice(0, 120) + (msg.text.length > 120 ? '…' : '');
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2 py-1 ${isUser ? 'flex-row-reverse' : ''}`}>
      <span className={`shrink-0 text-xs font-medium w-12 text-right ${isUser ? 'text-cyan-400' : 'text-zinc-500'}`}>
        {isUser ? 'You' : 'CC'}
      </span>
      <div className={`rounded px-2 py-1 text-xs ${isUser ? 'bg-cyan-950/40 text-cyan-200' : 'bg-zinc-800 text-zinc-300'}`}>
        {text}
      </div>
    </div>
  );
}

export function SessionPreviewCard({ session, anchorRef, onClose }: SessionPreviewCardProps) {
  const [messages, setMessages] = useState<ParsedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Position the card near the anchor
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const cardWidth = 360;
    const cardHeight = 280;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = rect.right + 8;
    let top = Math.max(8, rect.top);

    // Flip left if would overflow right
    if (left + cardWidth > windowWidth - 8) {
      left = rect.left - cardWidth - 8;
    }
    // Flip up if would overflow bottom
    if (top + cardHeight > windowHeight - 8) {
      top = windowHeight - cardHeight - 8;
    }

    setPosition({ top, left });
  }, [anchorRef]);

  // Fetch messages on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getSessionMessages(session.id)
      .then((data) => {
        if (cancelled) return;
        const msgs = (data.messages ?? []).slice(-PREVIEW_MESSAGE_COUNT);
        setMessages(msgs);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.id]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  if (!position) return null;

  return (
    <div
      ref={cardRef}
      className="fixed z-50 w-80 rounded-lg border border-zinc-600 bg-[var(--color-surface)] p-3 shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} />
          <span className="text-sm font-medium text-gray-200">{session.windowName || session.id}</span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

      {/* Meta */}
      <div className="mb-2 flex gap-4 text-xs text-zinc-500">
        <span>{formatTimeAgo(session.createdAt)}</span>
        <span>{session.permissionMode}</span>
      </div>

      {/* Messages */}
      <div className="max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-900/50 p-2">
        {loading ? (
          <div className="py-4 text-center text-xs text-zinc-500">Loading preview…</div>
        ) : messages.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-500">No messages yet</div>
        ) : (
          messages.map((msg, i) => <MessagePreview key={i} msg={msg} />)
        )}
      </div>

      <div className="mt-2 text-xs text-zinc-600">Hover to keep open · Click to open session</div>
    </div>
  );
}
