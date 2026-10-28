import type { AuctionEngine } from '@campusbid/auction-engine';

const POLL_INTERVAL_MS = 5_000;

export interface AuctionWorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runAuctionWorker(
  engine: AuctionEngine,
  logger: AuctionWorkerLogger,
  shouldStop: () => boolean,
): Promise<void> {
  while (!shouldStop()) {
    const startedAt = Date.now();
    try {
      const now = new Date();
      await engine.activateDueAuctions(now);
      const closed = await engine.closeDueAuctions(now);
      for (const auction of closed) {
        logger.info(
          {
            auctionId: auction._id,
            status: auction.status,
            version: auction.version,
          },
          'Auction closed',
        );
      }
    } catch (error) {
      logger.error({ err: error }, 'Auction worker iteration failed');
    }
    const remaining = POLL_INTERVAL_MS - (Date.now() - startedAt);
    if (remaining > 0 && !shouldStop()) await wait(remaining);
  }
}
