import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AuctionEngine } from '@campusbid/auction-engine';
import { requireRole } from '../middleware/require-role.js';
import { requireAuth } from '../middleware/auth-context.js';
import { BidsService } from '../modules/bids/service.js';

const objectIdSchema = z.string().regex(/^[\da-f]{24}$/i);
const paramsSchema = z.object({ id: objectIdSchema });
const bodySchema = z
  .object({ amountPaise: z.number().int().safe().nonnegative() })
  .strict();
const idempotencyKeySchema = z.string().min(1).max(200);

function bidInputFromRequest(
  request: Request,
):
  | { success: true; auctionId: string; amountPaise: number; idemKey: string }
  | { success: false } {
  const params = paramsSchema.safeParse(request.params);
  const body = bodySchema.safeParse(request.body as unknown);
  const idemKey = idempotencyKeySchema.safeParse(
    request.header('Idempotency-Key'),
  );
  if (!params.success || !body.success || !idemKey.success)
    return { success: false };
  return {
    success: true,
    auctionId: params.data.id,
    amountPaise: body.data.amountPaise,
    idemKey: idemKey.data,
  };
}

export function createBidsRouter(
  engine: AuctionEngine,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const bids = new BidsService(engine);
  router.post(
    '/:id/bids',
    authenticate,
    requireRole('BUYER'),
    (request, response, next) => {
      const parsed = bidInputFromRequest(request);
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid bid request' });
        return;
      }
      void bids.placeBid(requireAuth(request), parsed).then(
        (result) => {
          if (result.ok) {
            response.status(200).json(result);
            return;
          }
          if (result.code === 'WRONG_COLLEGE') {
            response.status(404).json({ error: 'Not found' });
            return;
          }
          const statusCode = result.code === 'SELF_BID' ? 403 : 409;
          response.status(statusCode).json(result);
        },
        (error: unknown) => next(error),
      );
    },
  );
  return router;
}
