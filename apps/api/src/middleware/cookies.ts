import type { Request } from 'express';

export function getRefreshCookie(
  request: Request,
  cookieName: string,
): string | undefined {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[cookieName];
  return typeof value === 'string' ? value : undefined;
}
