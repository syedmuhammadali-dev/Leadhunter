/** Runs async tasks with a fixed concurrency limit and a cap on how many may wait. */
export class TaskQueue {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxPending = 100,
  ) {
    if (concurrency < 1) throw new Error("concurrency must be at least 1");
  }

  get pending(): number {
    return this.waiting.length;
  }

  /** True when no more tasks can be queued. */
  get isFull(): boolean {
    return this.running >= this.concurrency && this.waiting.length >= this.maxPending;
  }

  get active(): number {
    return this.running;
  }

  /** Queue a task. Rejects immediately if too many tasks are already waiting. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      if (this.waiting.length >= this.maxPending) throw new Error("Audit queue is full, try again later");
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.running++;
    try {
      return await task();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
