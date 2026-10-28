import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from '../../config.js';
import { requireRole } from '../../middleware/require-role.js';
import { requireAuth } from '../../middleware/auth-context.js';
import { UploadServiceUnavailableError, UploadsService } from './service.js';

export function createUploadsRouter(
  config: AppConfig,
  authenticate: RequestHandler,
  clock?: () => Date,
): Router {
  const router = Router();
  const service = new UploadsService(config, clock);
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post(
    '/sign',
    authenticate,
    requireRole('SELLER'),
    limiter,
    (request, response, next) => {
      try {
        response.status(200).json(service.sign(requireAuth(request)));
      } catch (error) {
        if (error instanceof UploadServiceUnavailableError) {
          response.status(error.status).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  return router;
}
