import { Router } from 'express';
import {
  createAttendanceSession,
  listSessions,
  upsertAttendance
} from './attendance.service.js';
import { CreateSessionSchema, UpsertAttendanceSchema } from './attendance.types.js';

export const attendanceRouter = Router();

attendanceRouter.get('/sessions', async (req, res, next) => {
  try {
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
    const data = await listSessions(Number.isFinite(limit) ? limit : 30);
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post('/sessions', async (req, res, next) => {
  try {
    const payload = CreateSessionSchema.parse(req.body);
    const data = await createAttendanceSession(payload);
    res.status(201).json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

attendanceRouter.post('/sessions/:sessionId/records', async (req, res, next) => {
  try {
    const payload = UpsertAttendanceSchema.parse(req.body);
    const data = await upsertAttendance(req.params.sessionId, payload);
    res.json({
      status: 'ok',
      data
    });
  } catch (error) {
    next(error);
  }
});

