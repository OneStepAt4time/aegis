/**
 * __tests__/sessionCockpit09Sync.test.ts — Issue 09 of the session-cockpit
 * epic: scroll-sync signal propagation and model attribution store wiring.
 *
 * Pure store tests — no React rendering required. Zustand state updates are
 * synchronous so act() is not needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionEventsStore } from '../store/useSessionEventsStore';

function resetStore() {
  useSessionEventsStore.setState({ sessions: {} });
}

describe('useSessionEventsStore — setSeek', () => {
  beforeEach(resetStore);

  it('initialises seekMs to null and seekNonce to 0', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    const state = useSessionEventsStore.getState().sessions['s1'];
    expect(state.seekMs).toBeNull();
    expect(state.seekNonce).toBe(0);
  });

  it('sets seekMs and bumps seekNonce on first call', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().setSeek('s1', 1000);
    const state = useSessionEventsStore.getState().sessions['s1'];
    expect(state.seekMs).toBe(1000);
    expect(state.seekNonce).toBe(1);
  });

  it('bumps seekNonce on repeated calls to the same ms', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().setSeek('s1', 5000);
    useSessionEventsStore.getState().setSeek('s1', 5000);
    useSessionEventsStore.getState().setSeek('s1', 5000);
    const state = useSessionEventsStore.getState().sessions['s1'];
    expect(state.seekMs).toBe(5000);
    expect(state.seekNonce).toBe(3);
  });

  it('updates seekMs when ms changes', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().setSeek('s1', 1000);
    useSessionEventsStore.getState().setSeek('s1', 2000);
    const state = useSessionEventsStore.getState().sessions['s1'];
    expect(state.seekMs).toBe(2000);
    expect(state.seekNonce).toBe(2);
  });

  it('does not affect sibling sessions', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().ensureSession('s2');
    useSessionEventsStore.getState().setSeek('s1', 9999);
    const s2 = useSessionEventsStore.getState().sessions['s2'];
    expect(s2.seekMs).toBeNull();
    expect(s2.seekNonce).toBe(0);
  });
});

describe('useSessionEventsStore — setModel', () => {
  beforeEach(resetStore);

  it('initialises model to null', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    expect(useSessionEventsStore.getState().sessions['s1'].model).toBeNull();
  });

  it('stores the parsed model name', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().setModel('s1', 'claude-opus-4-7');
    expect(useSessionEventsStore.getState().sessions['s1'].model).toBe('claude-opus-4-7');
  });

  it('does not change the sessions reference when the same model is set again', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().setModel('s1', 'claude-sonnet-4-6');
    const before = useSessionEventsStore.getState().sessions;
    useSessionEventsStore.getState().setModel('s1', 'claude-sonnet-4-6');
    // The guard `if (prev.model === model) return s;` keeps the reference stable
    expect(useSessionEventsStore.getState().sessions).toBe(before);
  });

  it('updates model name when it changes', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().setModel('s1', 'claude-haiku-4-5');
    useSessionEventsStore.getState().setModel('s1', 'claude-opus-4-7');
    expect(useSessionEventsStore.getState().sessions['s1'].model).toBe('claude-opus-4-7');
  });

  it('supports BYO model names', () => {
    useSessionEventsStore.getState().ensureSession('s1');
    useSessionEventsStore.getState().ensureSession('s2');
    useSessionEventsStore.getState().ensureSession('s3');
    useSessionEventsStore.getState().setModel('s1', 'glm-5.1');
    useSessionEventsStore.getState().setModel('s2', 'gpt-4o-mini');
    useSessionEventsStore.getState().setModel('s3', 'llama3.1:70b');
    expect(useSessionEventsStore.getState().sessions['s1'].model).toBe('glm-5.1');
    expect(useSessionEventsStore.getState().sessions['s2'].model).toBe('gpt-4o-mini');
    expect(useSessionEventsStore.getState().sessions['s3'].model).toBe('llama3.1:70b');
  });
});
