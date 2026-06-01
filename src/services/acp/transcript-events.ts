import type { AcpEventRecord, AcpEventStore } from './event-store.js';
import type { AcpSessionScope } from './types.js';

// Utility: read all events for a session (simple paginated fetch).
export async function listAllTranscriptEvents(store: AcpEventStore, scope: AcpSessionScope, sessionId: string): Promise<AcpEventRecord[]> {
  const all: AcpEventRecord[] = [];
  let after = 0;
  while (true) {
    const batch = await store.list({ ...scope, sessionId, afterEventSeq: after, limit: 100 });
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    after = batch[batch.length - 1].eventSeq;
    if (batch.length < 100) break;
  }
  return all;
}
