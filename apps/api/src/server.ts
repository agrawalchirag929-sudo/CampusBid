import pino from 'pino';
import mongoose from 'mongoose';
import { app, auctionEngine } from './app.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const port = Number(process.env.PORT ?? 3000);
const mongoUri = process.env.MONGO_URI;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
if (!mongoUri) {
  throw new Error('MONGO_URI is required');
}

const server = async (): Promise<void> => {
  await mongoose.connect(mongoUri, { maxPoolSize: 100 });
  await auctionEngine.ensureIndexes();
  const httpServer = app.listen(port, () => {
    logger.info({ port }, 'CampusBid API listening');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      httpServer.close((error) => {
        if (error) {
          logger.error({ err: error }, 'API shutdown failed');
          process.exitCode = 1;
          return;
        }
        void mongoose.disconnect().then(
          () => logger.info('CampusBid API stopped'),
          (disconnectError: unknown) => {
            logger.error({ err: disconnectError }, 'MongoDB disconnect failed');
            process.exitCode = 1;
          },
        );
      });
    });
  }
};

void server().catch((error: unknown) => {
  logger.fatal({ err: error }, 'CampusBid API startup failed');
  process.exitCode = 1;
});
