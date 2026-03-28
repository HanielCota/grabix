/**
 * Simple counting semaphore for limiting concurrent async operations.
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private current = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Transfer the slot directly to the next waiter (no gap in count)
      next();
    } else {
      this.current--;
    }
  }
}
