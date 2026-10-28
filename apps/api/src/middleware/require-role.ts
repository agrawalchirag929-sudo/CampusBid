import type { RequestHandler } from 'express';
import type { UserRole } from '@campusbid/shared';

export class AuthorizationError extends Error {
  constructor() {
    super('Forbidden');
    this.name = 'AuthorizationError';
  }
}

export function assertRole(
  roles: readonly UserRole[],
  required: UserRole,
): void {
  if (!roles.includes(required)) throw new AuthorizationError();
}

export function requireRole(...requiredRoles: UserRole[]): RequestHandler {
  return (request, response, next) => {
    if (
      !request.auth ||
      !requiredRoles.some((role) => request.auth?.roles.includes(role))
    ) {
      response.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
