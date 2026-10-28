import mongoose from 'mongoose';
import pino from 'pino';
import { loadConfig } from '../../../config.js';
import { ConsoleMailProvider } from '../../auth/mail-provider.js';
import { createMailOutboxModel } from '../model.js';
import { MailOutboxWorker } from '../worker.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['token', 'verificationToken', 'password'],
    censor: '[Redacted]',
  },
});

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.MONGO_URI) throw new Error('MONGO_URI is required');
  const provider = new ConsoleMailProvider(config.NODE_ENV);
  await mongoose.connect(config.MONGO_URI, { maxPoolSize: 20 });
  const outbox = createMailOutboxModel(mongoose.connection);
  await outbox.init();
  const worker = new MailOutboxWorker(
    outbox,
    provider,
    config.JWT_SECRET,
    logger,
  );
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopping = true;
    });
  }
  try {
    while (!stopping) {
      const count = await worker.processBatch();
      if (count === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
  } finally {
    await mongoose.disconnect();
  }
}

void main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Mail worker startup or run failed');
  process.exitCode = 1;
});
