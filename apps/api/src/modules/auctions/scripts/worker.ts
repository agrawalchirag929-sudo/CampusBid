import mongoose from 'mongoose';
import pino from 'pino';
import { loadConfig } from '../../../config.js';
import { createAuctionEngine } from '@campusbid/auction-engine';
import { createListingModel } from '../../listings/model.js';
import { runAuctionWorker } from '../worker.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(config.MONGO_URI, { maxPoolSize: 20 });
  const engine = createAuctionEngine({
    connection: mongoose.connection,
    logger: { debug: (fields, message) => logger.debug(fields, message) },
  });
  await Promise.all([
    engine.ensureIndexes(),
    createListingModel(mongoose.connection).init(),
  ]);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopping = true;
    });
  }
  try {
    await runAuctionWorker(engine, logger, () => stopping);
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Auction worker startup or run failed');
  process.exitCode = 1;
});
