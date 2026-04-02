/**
 * Minimal FIFO async mutex for serializing critical sections.
 *
 * runExclusive guarantees the lock is released even if the callback throws.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(callback: () => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}