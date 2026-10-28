import { Router } from 'express';
import { z } from 'zod';
import type { RequestHandler, Response } from 'express';
import {
  loginSchema,
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
} from '@campusbid/shared';
import type { AppConfig } from '../../config.js';
import type { AuthService } from './service.js';
import { AuthServiceError } from './errors.js';
import { getRefreshCookie } from '../../middleware/cookies.js';

const refreshCookieSchema = z.string().min(1).max(256);

function setRefreshCookie(
  response: Response,
  config: AppConfig,
  value: string,
): void {
  response.cookie(config.COOKIE_NAME, value, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1_000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

function clearRefreshCookie(response: Response, config: AppConfig): void {
  response.clearCookie(config.COOKIE_NAME, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

function sendAuthError(response: Response, error: unknown): boolean {
  if (!(error instanceof AuthServiceError)) return false;
  response.status(error.status).json({ error: error.message });
  return true;
}

export function createAuthRouter(
  auth: AuthService,
  config: AppConfig,
  limiters: {
    signupIp: RequestHandler;
    loginIp: RequestHandler;
    loginEmail: RequestHandler;
    resendIp: RequestHandler;
    resendEmail: RequestHandler;
    verifyIp: RequestHandler;
    refreshIp: RequestHandler;
    logoutIp: RequestHandler;
  },
): Router {
  const router = Router();
  router.post('/signup', limiters.signupIp, async (request, response, next) => {
    const parsed = signupSchema.safeParse(request.body as unknown);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid signup request' });
      return;
    }
    try {
      response.status(202).json(await auth.signup(parsed.data));
    } catch (error) {
      if (!sendAuthError(response, error)) next(error);
    }
  });

  router.post(
    '/verify-email',
    limiters.verifyIp,
    async (request, response, next) => {
      const parsed = verifyEmailSchema.safeParse(request.body as unknown);
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid verification request' });
        return;
      }
      try {
        await auth.verifyEmail(parsed.data.token);
        response.status(204).end();
      } catch (error) {
        if (!sendAuthError(response, error)) next(error);
      }
    },
  );

  router.post(
    '/resend-verification',
    limiters.resendIp,
    limiters.resendEmail,
    async (request, response, next) => {
      const parsed = resendVerificationSchema.safeParse(
        request.body as unknown,
      );
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid verification request' });
        return;
      }
      try {
        response
          .status(202)
          .json(await auth.resendVerification(parsed.data.email));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/login',
    limiters.loginIp,
    limiters.loginEmail,
    async (request, response, next) => {
      const parsed = loginSchema.safeParse(request.body as unknown);
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid login request' });
        return;
      }
      try {
        const session = await auth.login(
          parsed.data.email,
          parsed.data.password,
        );
        setRefreshCookie(response, config, session.refreshToken);
        response.status(200).json({
          accessToken: session.accessToken,
          tokenType: 'Bearer',
          expiresIn: session.expiresIn,
        });
      } catch (error) {
        if (!sendAuthError(response, error)) next(error);
      }
    },
  );

  router.post(
    '/refresh',
    limiters.refreshIp,
    async (request, response, next) => {
      const parsedToken = refreshCookieSchema.safeParse(
        getRefreshCookie(request, config.COOKIE_NAME),
      );
      if (!parsedToken.success) {
        response.status(401).json({ error: 'Refresh session is invalid' });
        return;
      }
      try {
        const session = await auth.refresh(parsedToken.data);
        setRefreshCookie(response, config, session.refreshToken);
        response.status(200).json({
          accessToken: session.accessToken,
          tokenType: 'Bearer',
          expiresIn: session.expiresIn,
        });
      } catch (error) {
        if (!sendAuthError(response, error)) next(error);
      }
    },
  );

  router.post('/logout', limiters.logoutIp, async (request, response, next) => {
    const parsedToken = refreshCookieSchema
      .optional()
      .safeParse(getRefreshCookie(request, config.COOKIE_NAME));
    try {
      await auth.logout(parsedToken.success ? parsedToken.data : undefined);
      clearRefreshCookie(response, config);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
