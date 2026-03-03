import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { registrationsRouter } from './modules/registrations/registrations.routes.js';
import { billingRouter } from './modules/billing/billing.routes.js';
import { remindersRouter } from './modules/reminders/reminders.routes.js';
import { attendanceRouter } from './modules/attendance/attendance.routes.js';
import { playersRouter } from './modules/players/players.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { requireAuth } from './middleware/auth.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);

  app.use('/api/registrations', registrationsRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/reminders', remindersRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/players', playersRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/settings', settingsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
