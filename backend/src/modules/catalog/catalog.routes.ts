import { Router } from 'express';
import { listCoaches, listTrainingGroups } from './catalog.service.js';

export const catalogRouter = Router();

catalogRouter.get('/training-groups', async (_req, res, next) => {
  try {
    const data = await listTrainingGroups();
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/coaches', async (_req, res, next) => {
  try {
    const data = await listCoaches();
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

