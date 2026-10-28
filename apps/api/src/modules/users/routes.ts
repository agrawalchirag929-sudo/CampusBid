import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { adminUsersQuerySchema } from '@campusbid/shared';
import { ScopedResourceNotFoundError } from '../colleges/scope.js';
import { requireRole } from '../../middleware/require-role.js';
import type { UserService } from './service.js';

const userIdSchema = z.string().regex(/^[0-9a-f]{24}$/i);

export function createUsersRouter(
  users: UserService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.get('/me', authenticate, async (request, response, next) => {
    try {
      response.status(200).json(await users.me(request.auth!));
    } catch (error) {
      if (error instanceof ScopedResourceNotFoundError) {
        response.status(404).json({ error: 'Not found' });
        return;
      }
      next(error);
    }
  });
  return router;
}

export function createAdminUsersRouter(
  users: UserService,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  const admin = requireRole('ADMIN');
  router.get('/users', authenticate, admin, async (request, response, next) => {
    const parsed = adminUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid pagination parameters' });
      return;
    }
    try {
      response
        .status(200)
        .json(
          await users.listForAdmin(
            request.auth!,
            parsed.data.page,
            parsed.data.pageSize,
          ),
        );
    } catch (error) {
      if (error instanceof ScopedResourceNotFoundError) {
        response.status(404).json({ error: 'Not found' });
        return;
      }
      next(error);
    }
  });

  for (const [path, status] of [
    [':id/ban', 'banned'],
    [':id/unban', 'active'],
  ] as const) {
    router.post(
      `/users/${path}`,
      authenticate,
      admin,
      async (request, response, next) => {
        const parsedUserId = userIdSchema.safeParse(request.params.id);
        if (!parsedUserId.success) {
          response.status(404).json({ error: 'Not found' });
          return;
        }
        try {
          response
            .status(200)
            .json(
              await users.setStatusForAdmin(
                request.auth!,
                parsedUserId.data,
                status,
              ),
            );
        } catch (error) {
          if (error instanceof ScopedResourceNotFoundError) {
            response.status(404).json({ error: 'Not found' });
            return;
          }
          next(error);
        }
      },
    );
  }
  return router;
}
