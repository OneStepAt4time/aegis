export class CircularBuffer<T> {
  private readonly items: Array<T | undefined>;
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error(`CircularBuffer capacity must be a positive integer, got: ${capacity}`);
    }
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  toArray(): T[] {
    if (this.count === 0) {
      return [];
    }
    if (this.count < this.capacity) {
      return this.items.slice(0, this.count) as T[];
    }
    return [...this.items.slice(this.head), ...this.items.slice(0, this.head)] as T[];
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  size(): number {
    return this.count;
  }
}
