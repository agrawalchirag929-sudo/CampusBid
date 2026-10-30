import type { RequestHandler } from 'express';
import type { AuthContext } from '@campusbid/shared';
import type { AppConfig } from '../config.js';
import type { UserRepository } from '../modules/users/repository.js';
import { verifyAccessToken } from '../modules/auth/access-token.js';

const unauthorized = { error: 'Unauthorized' };

export function createAuthenticate(
  users: UserRepository,
  config: AppConfig,
): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      response.status(401).json(unauthorized);
      return;
    }

    const token = match[1];
    if (!token) {
      response.status(401).json(unauthorized);
      return;
    }

    const identity = await verifyAccessToken(token, config);
    if (!identity) {
      response.status(401).json(unauthorized);
      return;
    }

    try {
      const user = await users.findAuthenticatedUser(
        identity.userId,
        identity.collegeId,
      );
      if (!user) {
        response.status(401).json(unauthorized);
        return;
      }
      const auth: AuthContext = {
        userId: user._id.toString(),
        collegeId: user.collegeId.toString(),
        roles: [...user.roles],
      };
      request.auth = auth;
      next();
    } catch (error) {
      next(error);
    }
  };
}
