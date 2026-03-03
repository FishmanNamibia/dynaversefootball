import { Router } from 'express';
import {
  ListAuditSchema,
  TestEmailSchema,
  TestWhatsAppSchema,
  UpdateAcademyProfileSchema,
  UpdateBillingDefaultsSchema,
  UpdateChannelsSchema,
  UpdateReminderDefaultsSchema
} from './settings.types.js';
import {
  getSettingsDashboard,
  listSettingsAudit,
  testEmailChannel,
  testWhatsAppChannel,
  updateAcademyProfile,
  updateBillingDefaults,
  updateChannels,
  updateReminderDefaults
} from './settings.service.js';

export const settingsRouter = Router();

settingsRouter.get('/dashboard', async (_req, res, next) => {
  try {
    const data = await getSettingsDashboard();
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

settingsRouter.get('/audit', async (req, res, next) => {
  try {
    const parsed = ListAuditSchema.parse({
      limit: req.query.limit
    });
    const data = await listSettingsAudit(parsed.limit);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/academy', async (req, res, next) => {
  try {
    const payload = UpdateAcademyProfileSchema.parse(req.body);
    await updateAcademyProfile(payload, req.authUser?.username);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/billing', async (req, res, next) => {
  try {
    const payload = UpdateBillingDefaultsSchema.parse(req.body);
    await updateBillingDefaults(payload, req.authUser?.username);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/reminders', async (req, res, next) => {
  try {
    const payload = UpdateReminderDefaultsSchema.parse(req.body);
    await updateReminderDefaults(payload, req.authUser?.username);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

settingsRouter.put('/channels', async (req, res, next) => {
  try {
    const payload = UpdateChannelsSchema.parse(req.body);
    await updateChannels(payload, req.authUser?.username);
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post('/channels/test-email', async (req, res, next) => {
  try {
    const payload = TestEmailSchema.parse(req.body);
    const data = await testEmailChannel(payload, req.authUser?.username);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

settingsRouter.post('/channels/test-whatsapp', async (req, res, next) => {
  try {
    const payload = TestWhatsAppSchema.parse(req.body);
    const data = await testWhatsAppChannel(payload, req.authUser?.username);
    res.json({ status: 'ok', data });
  } catch (error) {
    next(error);
  }
});

