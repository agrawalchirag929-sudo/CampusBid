import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import type {
  AuctionEngine,
  PlaceBidInput,
} from '../../../../packages/auction-engine/src/index.js';
import type { TemporaryAuthContext } from '../middleware/auth-stub.js';

const objectIdSchema = z.string().regex(/^[\da-f]{24}$/i);
const paramsSchema = z.object({ id: objectIdSchema });
const bodySchema = z.object({
  amountPaise: z.number().int().safe().nonnegative(),
});
const idempotencyKeySchema = z.string().min(1).max(200);

function bidInputFromRequest(
  request: Request,
  response: Response,
):
  | { success: true; data: PlaceBidInput }
  | { success: false; issues: string[] } {
  const auth = response.locals.authContext as TemporaryAuthContext | undefined;
  const params = paramsSchema.safeParse(request.params);
  const body = bodySchema.safeParse(request.body as unknown);
  const idemKey = idempotencyKeySchema.safeParse(
    request.header('Idempotency-Key'),
  );
  if (!auth || !params.success || !body.success || !idemKey.success) {
    const issues = [
      ...(auth ? [] : ['Temporary auth headers are required']),
      ...(params.success
        ? []
        : params.error.issues.map((issue) => issue.message)),
      ...(body.success ? [] : body.error.issues.map((issue) => issue.message)),
      ...(idemKey.success
        ? []
        : idemKey.error.issues.map((issue) => issue.message)),
    ];
    return { success: false, issues };
  }

  return {
    success: true,
    data: {
      auctionId: params.data.id,
      bidderId: auth.userId,
      collegeId: auth.collegeId,
      amountPaise: body.data.amountPaise,
      idemKey: idemKey.data,
    },
  };
}

export function createBidsRouter(
  engine: AuctionEngine,
  authMiddleware: RequestHandler,
): Router {
  const router = Router();
  router.post('/:id/bids', authMiddleware, async (request, response, next) => {
    const parsed = bidInputFromRequest(request, response);
    if (!parsed.success) {
      response
        .status(400)
        .json({ error: 'Invalid bid request', issues: parsed.issues });
      return;
    }

    try {
      const result = await engine.placeBid(parsed.data);
      if (result.ok) {
        response.status(200).json(result);
        return;
      }

      const statusCode =
        result.code === 'WRONG_COLLEGE' || result.code === 'SELF_BID'
          ? 403
          : 409;
      response.status(statusCode).json(result);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
