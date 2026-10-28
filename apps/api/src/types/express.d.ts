import type { AuthContext } from '@campusbid/shared';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
