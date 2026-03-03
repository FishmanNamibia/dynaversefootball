import { Router } from 'express';
import { HttpError } from '../../utils/httpError.js';
import { getPlayerDetails, listPlayers } from './players.service.js';

export const playersRouter = Router();

playersRouter.get('/', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const data = await listPlayers({
      search,
      status,
      limit: Number.isFinite(limit) ? limit : 100
    });
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

playersRouter.get('/:playerId', async (req, res, next) => {
  try {
    const data = await getPlayerDetails(req.params.playerId);
    if (!data) {
      throw new HttpError(404, 'Player not found');
    }
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

