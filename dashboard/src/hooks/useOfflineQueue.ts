import { useCallback, useEffect, useState } from 'react';

interface QueuedAction {
  id: string;
  action: 'approve' | 'reject';
  sessionId: string;
  timestamp: number;
}

const QUEUE_KEY = 'aegis-offline-queue';

function getQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedAction[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('Failed to save offline queue:', e);
  }
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedAction[]>(getQueue);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const enqueue = useCallback((action: 'approve' | 'reject', sessionId: string) => {
    const item: QueuedAction = {
      id: crypto.randomUUID(),
      action,
      sessionId,
      timestamp: Date.now(),
    };
    const updated = [...getQueue(), item];
    saveQueue(updated);
    setQueue(updated);
    return item.id;
  }, []);

  const dequeue = useCallback((id: string) => {
    const updated = getQueue().filter((item) => item.id !== id);
    saveQueue(updated);
    setQueue(updated);
  }, []);

  const replay = useCallback(async (executor: (item: QueuedAction) => Promise<void>) => {
    const pending = getQueue();
    for (const item of pending) {
      try {
        await executor(item);
        dequeue(item.id);
      } catch (e) {
        console.error('Failed to replay queued action:', e);
      }
    }
  }, [dequeue]);

  useEffect(() => {
    if (isOnline && queue.length > 0) {
      // Consumers should call replay() explicitly when they're ready
    }
  }, [isOnline, queue.length]);

  return {
    isOnline,
    queue,
    enqueue,
    dequeue,
    replay,
  };
}
