import { Router } from 'express';
import {
  dispatchDueReminders,
  getCollectionsDashboard,
  getGuardianCollectionAccount,
  listCollectionAccounts,
  listPendingReminders,
  markGuardianAsContacted,
  sendBulkStageReminders,
  sendCollectionReminderToGuardian
} from './reminders.service.js';
import {
  CollectionsDashboardSchema,
  DispatchDueSchema,
  ListCollectionsAccountsSchema,
  ListPendingSchema,
  MarkGuardianContactedSchema,
  SendBulkStageRemindersSchema,
  SendGuardianReminderSchema
} from './reminders.types.js';

export const remindersRouter = Router();

remindersRouter.get('/pending', async (req, res, next) => {
  try {
    const parsed = ListPendingSchema.parse({
      limit: req.query.limit
    });
    const data = await listPendingReminders(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.post('/dispatch-due', async (req, res, next) => {
  try {
    const parsed = DispatchDueSchema.parse({
      limit: req.body?.limit
    });
    const data = await dispatchDueReminders(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.get('/collections/dashboard', async (req, res, next) => {
  try {
    const parsed = CollectionsDashboardSchema.parse({
      limit: req.query.limit
    });
    const data = await getCollectionsDashboard(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.get('/collections/accounts', async (req, res, next) => {
  try {
    const parsed = ListCollectionsAccountsSchema.parse({
      status: req.query.status,
      limit: req.query.limit
    });
    const data = await listCollectionAccounts(parsed.status, parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.get('/collections/accounts/:guardianId', async (req, res, next) => {
  try {
    const data = await getGuardianCollectionAccount(req.params.guardianId);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.post('/collections/accounts/:guardianId/send', async (req, res, next) => {
  try {
    const payload = SendGuardianReminderSchema.parse(req.body ?? {});
    const data = await sendCollectionReminderToGuardian({
      guardianId: req.params.guardianId,
      channel: payload.channel,
      stage: payload.stage,
      customMessage: payload.customMessage,
      actor: req.authUser?.username
    });
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.post('/collections/accounts/:guardianId/contacted', async (req, res, next) => {
  try {
    const payload = MarkGuardianContactedSchema.parse(req.body ?? {});
    const data = await markGuardianAsContacted(req.params.guardianId, payload.note, req.authUser?.username);
    res.status(201).json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

remindersRouter.post('/collections/bulk-send', async (req, res, next) => {
  try {
    const payload = SendBulkStageRemindersSchema.parse(req.body ?? {});
    const data = await sendBulkStageReminders({
      stage: payload.stage,
      channel: payload.channel,
      limit: payload.limit,
      actor: req.authUser?.username
    });
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});
