import { z } from 'zod';
import type { RequestHandler } from 'express';

const objectIdSchema = z.string().regex(/^[\da-f]{24}$/i);

export interface TemporaryAuthContext {
  userId: string;
  collegeId: string;
}

const temporaryHeadersSchema = z.object({
  userId: objectIdSchema,
  collegeId: objectIdSchema,
});

export function createTemporaryHeaderAuth(): RequestHandler {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TEMPORARY header authentication cannot run in production');
  }

  return (request, response, next) => {
    const auth = temporaryHeadersSchema.safeParse({
      userId: request.header('x-user-id'),
      collegeId: request.header('x-college-id'),
    });
    if (!auth.success) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    response.locals.authContext = auth.data satisfies TemporaryAuthContext;
    next();
  };
}
