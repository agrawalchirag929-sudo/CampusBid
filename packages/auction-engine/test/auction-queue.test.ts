import { describe, expect, it } from 'vitest';
import { KeyedAsyncQueue } from '../src/auction-queue.js';

describe('KeyedAsyncQueue', () => {
  it('serializes work per key and removes an idle key', async () => {
    const queue = new KeyedAsyncQueue();
    let active = 0;
    let maximumActive = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        queue.run('auction-a', async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await Promise.resolve();
          active -= 1;
        }),
      ),
    );

    expect(maximumActive).toBe(1);
    expect(queue.pendingKeyCount).toBe(0);
  });

  it('releases queued work and removes the key when a task throws', async () => {
    const queue = new KeyedAsyncQueue();
    const failed = queue.run('auction-a', () => {
      throw new Error('expected test failure');
    });
    const following = queue.run('auction-a', () => 'completed');

    await expect(failed).rejects.toThrow('expected test failure');
    await expect(following).resolves.toBe('completed');
    expect(queue.pendingKeyCount).toBe(0);
  });

  it('allows different auction keys to progress independently', async () => {
    const queue = new KeyedAsyncQueue();
    const releaseFirst = new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    const first = queue.run('auction-a', async () => {
      await releaseFirst;
      return 'a';
    });
    const second = queue.run('auction-b', () => 'b');

    await expect(second).resolves.toBe('b');
    await expect(first).resolves.toBe('a');
    expect(queue.pendingKeyCount).toBe(0);
  });
});
