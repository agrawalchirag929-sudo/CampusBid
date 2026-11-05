import pino from 'pino';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { app, auctionEngine, config, ensureApiIndexes } from './app.js';
import { runAuctionWorker } from './modules/auctions/worker.js';
import { createMailProvider } from './modules/auth/mail-provider.js';
import { createMailOutboxModel } from './modules/notifications/model.js';
import {
  MailOutboxWorker,
  runMailOutboxWorker,
} from './modules/notifications/worker.js';
import { createRealtimeServer } from './modules/realtime/server.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'passwordHash',
      'refreshToken',
      'token',
    ],
    censor: '[Redacted]',
  },
});

if (!config.MONGO_URI) throw new Error('MONGO_URI is required');

const server = async (): Promise<void> => {
  await mongoose.connect(config.MONGO_URI as string, { maxPoolSize: 100 });
  await ensureApiIndexes();
  const mailProvider = createMailProvider(config);
  const httpServer = createServer(app);
  const realtime = createRealtimeServer({
    httpServer,
    connection: mongoose.connection,
    engine: auctionEngine,
    config,
    logger,
  });
  realtime.start();
  httpServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'CampusBid API listening');
  });
  let workerStopping = false;
  const workerTask = config.RUN_WORKER
    ? Promise.all([
        runAuctionWorker(auctionEngine, logger, () => workerStopping),
        runMailOutboxWorker(
          new MailOutboxWorker(
            createMailOutboxModel(mongoose.connection),
            mailProvider,
            config.MAIL_OUTBOX_KEY,
            logger,
          ),
          logger,
          () => workerStopping,
        ),
      ]).then(() => undefined)
    : Promise.resolve();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      workerStopping = true;
      void realtime
        .close()
        .then(() => workerTask)
        .then(() => mongoose.disconnect())
        .then(
          () => logger.info('CampusBid API stopped'),
          (shutdownError: unknown) => {
            logger.error({ err: shutdownError }, 'API shutdown failed');
            process.exitCode = 1;
          },
        );
    });
  }
};

void server().catch((error: unknown) => {
  logger.fatal({ err: error }, 'CampusBid API startup failed');
  process.exitCode = 1;
});
