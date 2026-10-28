import express, { type ErrorRequestHandler, type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoose, { type Connection } from 'mongoose';
import pino from 'pino';
import {
  createAuctionEngine,
  type AuctionEngine,
} from '@campusbid/auction-engine';
import { loadConfig, type AppConfig } from './config.js';
import { createAuthModels } from './modules/auth/models.js';
import { AuthService } from './modules/auth/service.js';
import { createAuthRouter } from './modules/auth/routes.js';
import { createAuthLimiters } from './modules/auth/rate-limits.js';
import { createCollegeModel } from './modules/colleges/model.js';
import { createListingModel } from './modules/listings/model.js';
import { AuctionsService } from './modules/auctions/service.js';
import {
  createAuctionsRouter,
  createMyAuctionsRouter,
} from './modules/auctions/routes.js';
import { createUploadsRouter } from './modules/uploads/routes.js';
import { createUserModel } from './modules/users/model.js';
import { UserRepository } from './modules/users/repository.js';
import { UserService } from './modules/users/service.js';
import {
  createAdminUsersRouter,
  createUsersRouter,
} from './modules/users/routes.js';
import { createAuthenticate } from './middleware/authenticate.js';
import { AuthorizationError } from './middleware/require-role.js';
import { createCors } from './middleware/cors.js';
import { ScopedResourceNotFoundError } from './modules/colleges/scope.js';
import { createBidsRouter } from './routes/bids.js';
import { healthRouter } from './routes/health.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.set-cookie',
      'req.body.password',
      'request.headers.authorization',
      'request.headers.cookie',
      'password',
      'passwordHash',
      'refreshToken',
      'verificationToken',
      'token',
    ],
    censor: '[Redacted]',
  },
});

export interface CreateAppOptions {
  config?: AppConfig;
  connection?: Connection;
  engine?: AuctionEngine;
  clock?: () => Date;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const runtimeConfig = options.config ?? loadConfig();
  if (runtimeConfig.NODE_ENV === 'production') {
    throw new Error(
      'A production MailProvider must be configured before API startup',
    );
  }
  const connection = options.connection ?? mongoose.connection;
  const engine = options.engine ?? createAuctionEngine({ connection });
  const authModels = createAuthModels(connection);
  const users = new UserRepository(connection);
  const authService = new AuthService({
    connection,
    config: runtimeConfig,
    users,
    authModels,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const userService = new UserService(
    connection,
    users,
    authModels.RefreshToken,
    options.clock,
  );
  const auctionsService = new AuctionsService(
    connection,
    engine,
    runtimeConfig,
    options.clock,
  );
  const authenticate = createAuthenticate(users, runtimeConfig);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', runtimeConfig.TRUST_PROXY);
  app.use(helmet());
  app.use(createCors(runtimeConfig));
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use('/health', healthRouter);
  app.use(
    '/auth',
    createAuthRouter(
      authService,
      runtimeConfig,
      createAuthLimiters(runtimeConfig.NODE_ENV),
    ),
  );
  app.use('/', createUsersRouter(userService, authenticate));
  app.use('/admin', createAdminUsersRouter(userService, authenticate));
  app.use('/me', createMyAuctionsRouter(auctionsService, authenticate));
  app.use(
    '/uploads',
    createUploadsRouter(runtimeConfig, authenticate, options.clock),
  );
  app.use('/auctions', createAuctionsRouter(auctionsService, authenticate));
  app.use('/auctions', createBidsRouter(engine, authenticate));

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
    if (error instanceof AuthorizationError) {
      response.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (error instanceof ScopedResourceNotFoundError) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    logger.error({ err: error }, 'Unhandled API error');
    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}

export const config = loadConfig();
export const auctionEngine = createAuctionEngine({
  connection: mongoose.connection,
  logger: {
    debug: (fields, message) => logger.debug(fields, message),
  },
});
export const app = createApp({ config, engine: auctionEngine });

export async function ensureApiIndexes(): Promise<void> {
  await Promise.all([
    createCollegeModel(mongoose.connection).init(),
    createUserModel(mongoose.connection).init(),
    ...Object.values(createAuthModels(mongoose.connection)).map((model) =>
      model.init(),
    ),
    createListingModel(mongoose.connection).init(),
    auctionEngine.ensureIndexes(),
  ]);
}
