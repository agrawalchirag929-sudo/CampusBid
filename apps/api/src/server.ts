import pino from 'pino';
import mongoose from 'mongoose';
import { app, config, ensureApiIndexes } from './app.js';

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
  const httpServer = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'CampusBid API listening');
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
