import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';

describe('SessionMonitor idle broadcasts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits idle after the debounce window even when later polls stay idle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const session = {
      id: 'sess-idle',
      windowName: 'cc-idle',
      workDir: '/tmp/project',
      status: 'working',
    } as any;

    const states = [
      { messages: [], status: 'working' as const, statusText: null, interactiveContent: null },
      { messages: [], status: 'idle' as const, statusText: 'Done', interactiveContent: null },
      { messages: [], status: 'idle' as const, statusText: 'Done', interactiveContent: null },
    ];

    const sessionsStub = {
      readMessagesForMonitor: vi.fn(async () => states.shift() ?? states[states.length - 1]),
    } as any;

    const channelsStub = {
      statusChange: vi.fn(async () => {}),
      message: vi.fn(async () => {}),
    } as any;

    const eventBusStub = {
      emitStatus: vi.fn(),
      emitApproval: vi.fn(),
      emitMessage: vi.fn(),
      emitSystem: vi.fn(),
      emitStall: vi.fn(),
    } as any;

    const monitor = new SessionMonitor(sessionsStub, channelsStub, DEFAULT_MONITOR_CONFIG);
    monitor.setEventBus(eventBusStub);

    await (monitor as any).checkSession(session);
    await vi.advanceTimersByTimeAsync(600);

    expect(eventBusStub.emitStatus).toHaveBeenCalledWith(session.id, 'working', 'Claude is working');

    await (monitor as any).checkSession(session);
    await vi.advanceTimersByTimeAsync(600);

    expect(eventBusStub.emitStatus).not.toHaveBeenCalledWith(session.id, 'idle', expect.any(String));

    (monitor as any).idleSince.set(session.id, Date.now() - 4_000);

    await (monitor as any).checkSession(session);
    await vi.advanceTimersByTimeAsync(600);

    expect(eventBusStub.emitStatus).toHaveBeenCalledWith(session.id, 'idle', 'Done');
  });
});
