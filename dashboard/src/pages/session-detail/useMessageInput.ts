/**
 * session-detail/useMessageInput.ts — Hook for message sending with history.
 */

import { useState, useRef, useCallback } from 'react';
import { sendMessage } from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { useT } from '../../i18n/context';

interface UseMessageInputReturn {
  msgInput: string;
  setMsgInput: React.Dispatch<React.SetStateAction<string>>;
  sending: boolean;
  handleSend: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  sendHistoryRef: React.MutableRefObject<string[]>;
  historyIndexRef: React.MutableRefObject<number>;
  getVisibleMessageInput: () => HTMLInputElement | null;
  desktopMsgInputRef: React.RefObject<HTMLInputElement | null>;
  mobileMsgInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useMessageInput(
  sessionId: string,
): UseMessageInputReturn {
  const t = useT();
  const addToast = useToastStore((t_store) => t_store.addToast);
  const [msgInput, setMsgInput] = useState('');
  const [sending, setSending] = useState(false);
  const sendHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const desktopMsgInputRef = useRef<HTMLInputElement>(null);
  const mobileMsgInputRef = useRef<HTMLInputElement>(null);
  const sendingRef = useRef(false);

  function getVisibleMessageInput(): HTMLInputElement | null {
    const candidates = [desktopMsgInputRef.current, mobileMsgInputRef.current].filter(
      (input): input is HTMLInputElement => input !== null,
    );
    return candidates.find((input) => input.offsetParent !== null) ?? candidates[0] ?? null;
  }

  const handleSend = useCallback(async () => {
    const text = msgInput.trim();
    if (!text) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await sendMessage(sessionId, text);
      setMsgInput('');
      const hist = sendHistoryRef.current;
      if (hist[hist.length - 1] !== text) hist.push(text);
      if (hist.length > 50) hist.shift();
      historyIndexRef.current = -1;
    } catch (e: unknown) {
      addToast('error', t('sessionDetail.sendFailed'), e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
      sendingRef.current = false;
      getVisibleMessageInput()?.focus();
    }
  }, [msgInput, sessionId, addToast, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    const hist = sendHistoryRef.current;
    if (hist.length === 0) return;
    const usingHistory =
      msgInput === '' || historyIndexRef.current !== -1;
    if (!usingHistory) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = historyIndexRef.current === -1
        ? hist.length - 1
        : Math.max(0, historyIndexRef.current - 1);
      historyIndexRef.current = nextIdx;
      setMsgInput(hist[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current === -1) return;
      const nextIdx = historyIndexRef.current + 1;
      if (nextIdx >= hist.length) {
        historyIndexRef.current = -1;
        setMsgInput('');
      } else {
        historyIndexRef.current = nextIdx;
        setMsgInput(hist[nextIdx] ?? '');
      }
    }
  }, [msgInput, handleSend]);

  return {
    msgInput,
    setMsgInput,
    sending,
    handleSend,
    handleKeyDown,
    sendHistoryRef,
    historyIndexRef,
    getVisibleMessageInput,
    desktopMsgInputRef,
    mobileMsgInputRef,
  };
}
