import { pool } from '../../db/pool.js';
import { sendEmailMessage, sendWhatsAppMessage } from '../../integrations/messaging.js';
import { HttpError } from '../../utils/httpError.js';
import {
  appendAuditLog,
  getAcademyProfileSettings,
  getBillingDefaultsSettings,
  getChannelsSettings,
  getReminderDefaultsSettings,
  listAuditEntries,
  sanitizeChannelsForClient,
  upsertSystemSetting,
  type SettingsAuditEntry
} from './settings.store.js';
import type {
  TestEmailInput,
  TestWhatsAppInput,
  UpdateAcademyProfileInput,
  UpdateBillingDefaultsInput,
  UpdateChannelsInput,
  UpdateReminderDefaultsInput
} from './settings.types.js';

type HealthRow = {
  active_players: number;
  open_invoices: number;
  overdue_invoices: number;
  pending_reminders: number;
  failed_reminders_30d: number;
};

type OperationalAuditRow = {
  id: string;
  created_at: string;
  details: unknown;
};

function normalizeActor(actor: string | undefined): string {
  const cleaned = (actor ?? '').trim();
  return cleaned.length > 0 ? cleaned : 'admin';
}

export async function getSettingsDashboard(): Promise<{
  settings: {
    academyProfile: Awaited<ReturnType<typeof getAcademyProfileSettings>>;
    billingDefaults: Awaited<ReturnType<typeof getBillingDefaultsSettings>>;
    reminderDefaults: Awaited<ReturnType<typeof getReminderDefaultsSettings>>;
    channels: Record<string, unknown>;
  };
  health: {
    activePlayers: number;
    openInvoices: number;
    overdueInvoices: number;
    pendingReminders: number;
    failedRemindersLast30Days: number;
  };
  audit: SettingsAuditEntry[];
}> {
  const [academyProfile, billingDefaults, reminderDefaults, channelsRaw, health, audit] =
    await Promise.all([
      getAcademyProfileSettings(),
      getBillingDefaultsSettings(),
      getReminderDefaultsSettings(),
      getChannelsSettings(),
      getSystemHealth(),
      listSettingsAudit(40)
    ]);

  return {
    settings: {
      academyProfile,
      billingDefaults,
      reminderDefaults,
      channels: sanitizeChannelsForClient(channelsRaw)
    },
    health,
    audit
  };
}

export async function updateAcademyProfile(
  payload: UpdateAcademyProfileInput,
  actor: string | undefined
): Promise<void> {
  await upsertSystemSetting('academy_profile', payload, normalizeActor(actor));
}

export async function updateBillingDefaults(
  payload: UpdateBillingDefaultsInput,
  actor: string | undefined
): Promise<void> {
  await upsertSystemSetting('billing_defaults', payload, normalizeActor(actor));

  await pool.query(
    `
      UPDATE fee_plans
      SET amount = $2, currency = $3, updated_at = NOW()
      WHERE code = $1
    `,
    ['REGISTRATION_ONCE', payload.registrationFee, payload.defaultCurrency]
  );
  await pool.query(
    `
      UPDATE fee_plans
      SET amount = $2, currency = $3, updated_at = NOW()
      WHERE code = $1
    `,
    ['MONTHLY_SUBSCRIPTION', payload.monthlyFee, payload.defaultCurrency]
  );
  await pool.query(
    `
      UPDATE player_fee_assignments
      SET due_day_of_month = $1, updated_at = NOW()
      WHERE is_active = TRUE
    `,
    [payload.dueDayOfMonth]
  );
}

export async function updateReminderDefaults(
  payload: UpdateReminderDefaultsInput,
  actor: string | undefined
): Promise<void> {
  await upsertSystemSetting('reminder_defaults', payload, normalizeActor(actor));

  await pool.query(
    `
      INSERT INTO reminder_rules (name, trigger_type, offset_days, channel, template_key, is_active)
      VALUES ('Invoice reminder before due', 'before_due', $1, 'email', 'invoice_before_due_custom', $2)
      ON CONFLICT (name)
      DO UPDATE SET offset_days = EXCLUDED.offset_days, is_active = EXCLUDED.is_active, updated_at = NOW()
    `,
    [payload.beforeDueDays, payload.enableEmail]
  );

  await pool.query(
    `
      INSERT INTO reminder_rules (name, trigger_type, offset_days, channel, template_key, is_active)
      VALUES ('Invoice reminder overdue', 'overdue', $1, 'email', 'invoice_overdue_custom', $2)
      ON CONFLICT (name)
      DO UPDATE SET offset_days = EXCLUDED.offset_days, is_active = EXCLUDED.is_active, updated_at = NOW()
    `,
    [payload.overdueDays, payload.enableEmail]
  );
}

export async function updateChannels(
  payload: UpdateChannelsInput,
  actor: string | undefined
): Promise<void> {
  const current = await getChannelsSettings();
  const next = {
    smtpHost: payload.smtpHost ?? current.smtpHost,
    smtpPort: payload.smtpPort ?? current.smtpPort,
    smtpSecure: payload.smtpSecure ?? current.smtpSecure,
    smtpUser: payload.smtpUser ?? current.smtpUser,
    smtpPass: payload.smtpPass ?? current.smtpPass,
    emailFrom: payload.emailFrom ?? current.emailFrom,
    smtpSimulate: payload.smtpSimulate ?? current.smtpSimulate,
    whatsappApiUrl: payload.whatsappApiUrl ?? current.whatsappApiUrl,
    whatsappApiToken: payload.whatsappApiToken ?? current.whatsappApiToken,
    whatsappDefaultSender: payload.whatsappDefaultSender ?? current.whatsappDefaultSender,
    whatsappSimulate: payload.whatsappSimulate ?? current.whatsappSimulate
  };
  await upsertSystemSetting('channels_config', next, normalizeActor(actor));
}

export async function testEmailChannel(
  payload: TestEmailInput,
  actor: string | undefined
): Promise<{ recipient: string; providerMessageId?: string; simulated: boolean }> {
  const delivery = await sendEmailMessage({
    to: payload.toEmail,
    subject: 'Dynaverse FA Settings Test Email',
    text: 'This is a test email from Dynaverse Football Academy MIS settings module.'
  });

  if (!delivery.success) {
    throw new HttpError(502, delivery.error ?? 'Email test failed');
  }

  await appendAuditLog(normalizeActor(actor), 'channels.test_email', 'channels_config', {
    recipient: payload.toEmail,
    simulated: delivery.simulated,
    providerMessageId: delivery.providerMessageId ?? null
  });

  return {
    recipient: payload.toEmail,
    providerMessageId: delivery.providerMessageId,
    simulated: delivery.simulated
  };
}

export async function testWhatsAppChannel(
  payload: TestWhatsAppInput,
  actor: string | undefined
): Promise<{ recipient: string; providerMessageId?: string; simulated: boolean }> {
  const delivery = await sendWhatsAppMessage({
    to: payload.toPhone,
    message:
      payload.message ??
      'Dynaverse Football Academy MIS test message. WhatsApp channel is connected.'
  });

  if (!delivery.success) {
    throw new HttpError(502, delivery.error ?? 'WhatsApp test failed');
  }

  await appendAuditLog(normalizeActor(actor), 'channels.test_whatsapp', 'channels_config', {
    recipient: payload.toPhone,
    simulated: delivery.simulated,
    providerMessageId: delivery.providerMessageId ?? null
  });

  return {
    recipient: payload.toPhone,
    providerMessageId: delivery.providerMessageId,
    simulated: delivery.simulated
  };
}

export async function listSettingsAudit(limit = 50): Promise<SettingsAuditEntry[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
  const [settingsAudit, payments, invoices, reminders] = await Promise.all([
    listAuditEntries(normalizedLimit),
    pool.query<OperationalAuditRow>(
      `
        SELECT id, created_at::text, jsonb_build_object(
          'paymentId', id,
          'amount', amount::text,
          'method', method::text
        ) AS details
        FROM payments
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [normalizedLimit]
    ),
    pool.query<OperationalAuditRow>(
      `
        SELECT id, created_at::text, jsonb_build_object(
          'invoiceId', id,
          'invoiceNumber', invoice_number,
          'status', status::text
        ) AS details
        FROM invoices
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [normalizedLimit]
    ),
    pool.query<OperationalAuditRow>(
      `
        SELECT id, COALESCE(sent_at, created_at)::text AS created_at, jsonb_build_object(
          'reminderEventId', id,
          'status', status,
          'error', error_message
        ) AS details
        FROM reminder_events
        ORDER BY COALESCE(sent_at, created_at) DESC
        LIMIT $1
      `,
      [normalizedLimit]
    )
  ]);

  const operational: SettingsAuditEntry[] = [
    ...payments.rows.map((row) => ({
      id: `payment-${row.id}`,
      actor: 'system',
      action: 'payment.recorded',
      section: 'billing',
      details: row.details,
      createdAt: row.created_at
    })),
    ...invoices.rows.map((row) => ({
      id: `invoice-${row.id}`,
      actor: 'system',
      action: 'invoice.created',
      section: 'billing',
      details: row.details,
      createdAt: row.created_at
    })),
    ...reminders.rows.map((row) => ({
      id: `reminder-${row.id}`,
      actor: 'system',
      action: 'reminder.event',
      section: 'reminders',
      details: row.details,
      createdAt: row.created_at
    }))
  ];

  return [...settingsAudit, ...operational]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, normalizedLimit);
}

async function getSystemHealth(): Promise<{
  activePlayers: number;
  openInvoices: number;
  overdueInvoices: number;
  pendingReminders: number;
  failedRemindersLast30Days: number;
}> {
  const result = await pool.query<HealthRow>(
    `
      SELECT
        (SELECT COUNT(*)::int FROM players WHERE status = 'active') AS active_players,
        (SELECT COUNT(*)::int FROM invoices WHERE status IN ('sent', 'partially_paid', 'overdue')) AS open_invoices,
        (SELECT COUNT(*)::int FROM invoices WHERE status = 'overdue') AS overdue_invoices,
        (SELECT COUNT(*)::int FROM reminder_events WHERE status = 'pending') AS pending_reminders,
        (
          SELECT COUNT(*)::int
          FROM reminder_events
          WHERE status = 'failed'
            AND created_at >= NOW() - INTERVAL '30 days'
        ) AS failed_reminders_30d
    `
  );

  const row = result.rows[0];
  return {
    activePlayers: row?.active_players ?? 0,
    openInvoices: row?.open_invoices ?? 0,
    overdueInvoices: row?.overdue_invoices ?? 0,
    pendingReminders: row?.pending_reminders ?? 0,
    failedRemindersLast30Days: row?.failed_reminders_30d ?? 0
  };
}

