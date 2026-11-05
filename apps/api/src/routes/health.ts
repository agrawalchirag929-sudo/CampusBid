import { Router } from 'express';
import mongoose, { type Connection } from 'mongoose';

export function createHealthRouter(connection: Connection): Router {
  const router = Router();

  router.get('/', async (_request, response) => {
    if (connection.readyState !== 1 || !connection.db) {
      response.status(503).json({
        status: 'unavailable',
        database: 'disconnected',
      });
      return;
    }
    try {
      await connection.db.admin().ping();
      response.status(200).json({ status: 'ok', database: 'connected' });
    } catch {
      response.status(503).json({
        status: 'unavailable',
        database: 'disconnected',
      });
    }
  });
  return router;
}

export const healthRouter = createHealthRouter(mongoose.connection);
