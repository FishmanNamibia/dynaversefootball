import { Router } from 'express';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'dynaacademy-backend'
  });
});

healthRouter.get('/db', async (_req, res, next) => {
  try {
    const result = await pool.query<{ now: string }>('SELECT NOW()::text AS now');
    res.json({
      status: 'ok',
      databaseTime: result.rows[0]?.now ?? null
    });
  } catch (error) {
    next(error);
  }
});

