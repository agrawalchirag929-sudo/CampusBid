import type { Request } from 'express';
import type { AuthContext } from '@campusbid/shared';

export function requireAuth(request: Request): AuthContext {
  if (!request.auth)
    throw new Error('Authentication middleware was not applied');
  return request.auth;
}
