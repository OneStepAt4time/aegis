import type { AcpEventRecord, AcpEventStore } from './event-store.js';
import type { AcpSessionScope } from './types.js';

const ACP_EVENT_PAGE_LIMIT = 1_000;

export async function listAllTranscriptEvents(
  eventStore: AcpEventStore,
  scope: AcpSessionScope,
  sessionId: string,
): Promise<AcpEventRecord[]> {
  const events: AcpEventRecord[] = [];
  let afterEventSeq: number | undefined;

  for (;;) {
    const page = await eventStore.list({
      sessionId,
      ...scope,
      afterEventSeq,
      limit: ACP_EVENT_PAGE_LIMIT,
    });
    events.push(...page);
    if (page.length < ACP_EVENT_PAGE_LIMIT) return events;
    afterEventSeq = page[page.length - 1]?.eventSeq;
  }
}
