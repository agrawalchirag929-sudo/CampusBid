import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { CancelAuctionResponse } from '@campusbid/shared';
import { requireAuth } from '../../middleware/auth-context.js';
import { requireRole } from '../../middleware/require-role.js';
import { ScopedResourceNotFoundError } from '../colleges/scope.js';
import { AuctionRequestError, InvalidAuctionCursorError } from './errors.js';
import {
  auctionListQuerySchema,
  createAuctionSchema,
  objectIdParamsSchema,
  patchAuctionSchema,
} from './schemas.js';
import type { AuctionsService } from './service.js';

export function createAuctionsRouter(
  service: AuctionsService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const seller = requireRole('SELLER');

  router.post('/', authenticate, seller, async (request, response, next) => {
    const parsed = createAuctionSchema.safeParse(request.body as unknown);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auction request' });
      return;
    }
    try {
      response
        .status(201)
        .json(await service.create(requireAuth(request), parsed.data));
    } catch (error) {
      next(error);
    }
  });

  router.get('/', authenticate, async (request, response, next) => {
    const parsed = auctionListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid auction filters' });
      return;
    }
    try {
      response
        .status(200)
        .json(await service.list(requireAuth(request), parsed.data));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', authenticate, async (request, response, next) => {
    const parsed = objectIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      response
        .status(200)
        .json(await service.detail(requireAuth(request), parsed.data.id));
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/:id',
    authenticate,
    seller,
    async (request, response, next) => {
      const params = objectIdParamsSchema.safeParse(request.params);
      const body = patchAuctionSchema.safeParse(request.body as unknown);
      if (!params.success || !body.success) {
        response.status(400).json({ error: 'Invalid auction update' });
        return;
      }
      try {
        response
          .status(200)
          .json(
            await service.patch(
              requireAuth(request),
              params.data.id,
              body.data,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post('/:id/cancel', authenticate, async (request, response, next) => {
    const params = objectIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      response.status(404).json({ error: 'Not found' });
      return;
    }
    try {
      const auction = await service.cancel(
        requireAuth(request),
        params.data.id,
      );
      const result: CancelAuctionResponse = {
        id: auction._id,
        status: 'cancelled',
        version: auction.version,
      };
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error instanceof ScopedResourceNotFoundError) {
        response.status(404).json({ error: 'Not found' });
        return;
      }
      if (error instanceof AuctionRequestError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof InvalidAuctionCursorError) {
        response.status(400).json({ error: 'Invalid auction cursor' });
        return;
      }
      next(error);
    },
  );
  return router;
}

export function createMyAuctionsRouter(
  service: AuctionsService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.get('/auctions', authenticate, async (request, response, next) => {
    try {
      response
        .status(200)
        .json(await service.ownAuctions(requireAuth(request)));
    } catch (error) {
      next(error);
    }
  });
  router.get('/bids', authenticate, async (request, response, next) => {
    try {
      response.status(200).json(await service.ownBids(requireAuth(request)));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
