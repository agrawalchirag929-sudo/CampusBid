import type { RequestHandler } from 'express';
import cors from 'cors';
import type { AppConfig } from '../config.js';

export function createCors(config: AppConfig): RequestHandler {
  const origins = new Set(config.CORS_ORIGINS);
  return cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || origins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
}
