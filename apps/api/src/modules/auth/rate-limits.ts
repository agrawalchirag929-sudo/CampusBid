import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Request } from 'express';

function normalizedEmail(request: Request): string | null {
  const body = request.body as unknown;
  if (typeof body !== 'object' || body === null || !('email' in body))
    return null;
  const value = body.email;
  return typeof value === 'string' && value.includes('@')
    ? value.trim().toLowerCase()
    : null;
}

function perEmailKey(request: Request): string {
  const email = normalizedEmail(request);
  return email
    ? `email:${email}`
    : `ip:${ipKeyGenerator(request.ip ?? 'unknown')}`;
}

function limiter(
  windowMs: number,
  limit: number,
  keyGenerator?: (request: Request) => string,
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    message: { error: 'Too many requests' },
  });
}

export function createAuthLimiters(nodeEnv: string) {
  const testMultiplier = nodeEnv === 'test' ? 100 : 1;
  return {
    signupIp: limiter(15 * 60 * 1_000, 5 * testMultiplier),
    loginIp: limiter(15 * 60 * 1_000, 10 * testMultiplier),
    loginEmail: limiter(60 * 60 * 1_000, 10 * testMultiplier, perEmailKey),
    resendIp: limiter(15 * 60 * 1_000, 5 * testMultiplier),
    resendEmail: limiter(60 * 60 * 1_000, 3 * testMultiplier, perEmailKey),
    verifyIp: limiter(15 * 60 * 1_000, 20 * testMultiplier),
    refreshIp: limiter(15 * 60 * 1_000, 30 * testMultiplier),
    logoutIp: limiter(15 * 60 * 1_000, 30 * testMultiplier),
  };
}
