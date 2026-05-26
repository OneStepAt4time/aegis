/**
 * Centralized registry for setTimeout/setInterval handles.
 * Enables clean bulk-clear on shutdown and prevents orphaned timers.
 */
export class TimerRegistry {
  private readonly handles = new Set<ReturnType<typeof setTimeout | typeof setInterval>>();

  /** Wrap setTimeout — auto-untracks after firing. */
  setTimeout<TArgs extends unknown[]>(
    fn: (...args: TArgs) => void,
    ms: number,
    ...args: TArgs
  ): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this.handles.delete(id as ReturnType<typeof setInterval>);
      fn(...args);
    }, ms);
    this.handles.add(id as ReturnType<typeof setInterval>);
    return id;
  }

  /** Wrap setInterval — stays tracked until clearInterval or clearAll. */
  setInterval<TArgs extends unknown[]>(fn: (...args: TArgs) => void, ms: number, ...args: TArgs): ReturnType<typeof setInterval> {
    const id = setInterval(fn, ms, ...args) as ReturnType<typeof setInterval>;
    this.handles.add(id);
    return id;
  }

  /** Clear a tracked timeout. */
  clearTimeout(id: ReturnType<typeof setTimeout>): void {
    clearTimeout(id);
    this.handles.delete(id as ReturnType<typeof setInterval>);
  }

  /** Clear a tracked interval. */
  clearInterval(id: ReturnType<typeof setInterval>): void {
    clearInterval(id);
    this.handles.delete(id);
  }


  /** Track an externally-created handle (e.g. from a plugin that returns its own interval). */
  track(id: ReturnType<typeof setTimeout | typeof setInterval>): void {
    this.handles.add(id as ReturnType<typeof setInterval>);
  }

  /** Clear all tracked timers. */
  clearAll(): void {
    // clearTimeout also clears intervals in Node.js — using it for both is safe
    for (const id of this.handles) {
      clearTimeout(id);
    }
    this.handles.clear();
  }

  /** Number of currently active (pending) timers. */
  get activeCount(): number {
    return this.handles.size;
  }
}
