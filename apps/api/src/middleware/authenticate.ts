import type { RequestHandler } from 'express';
import { jwtVerify } from 'jose';
import { Types } from 'mongoose';
import type { AuthContext } from '@campusbid/shared';
import type { AppConfig } from '../config.js';
import type { UserRepository } from '../modules/users/repository.js';

const unauthorized = { error: 'Unauthorized' };

export function createAuthenticate(
  users: UserRepository,
  config: AppConfig,
): RequestHandler {
  const key = new TextEncoder().encode(config.JWT_SECRET);
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

    let payload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
        issuer: 'campusbid-api',
        audience: 'campusbid-client',
      }));
    } catch {
      response.status(401).json(unauthorized);
      return;
    }

    if (
      typeof payload.sub !== 'string' ||
      !Types.ObjectId.isValid(payload.sub) ||
      typeof payload.collegeId !== 'string' ||
      !Types.ObjectId.isValid(payload.collegeId)
    ) {
      response.status(401).json(unauthorized);
      return;
    }

    try {
      const user = await users.findAuthenticatedUser(
        payload.sub,
        payload.collegeId,
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
