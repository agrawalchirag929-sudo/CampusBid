export class KeyedAsyncQueue {
  private readonly tails = new Map<string, Promise<void>>();

  get pendingKeyCount(): number {
    return this.tails.size;
  }

  async run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);

    try {
      return await previous.then(task);
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
