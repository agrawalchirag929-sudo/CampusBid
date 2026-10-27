import express, { type ErrorRequestHandler, type Express } from 'express';
import mongoose from 'mongoose';
import pino from 'pino';
import {
  createAuctionEngine,
  type AuctionEngine,
} from '@campusbid/auction-engine';
import { createTemporaryHeaderAuth } from './middleware/auth-stub.js';
import { createBidsRouter } from './routes/bids.js';
import { healthRouter } from './routes/health.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
export const auctionEngine = createAuctionEngine({
  connection: mongoose.connection,
  logger: {
    debug: (fields, message) => logger.debug(fields, message),
  },
});

export function createApp(engine: AuctionEngine = auctionEngine): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/health', healthRouter);
  app.use('/auctions', createBidsRouter(engine, createTemporaryHeaderAuth()));
  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    logger.error({ err: error }, 'Unhandled API error');
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}

export const app = createApp();
