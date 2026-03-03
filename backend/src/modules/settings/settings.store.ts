import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';

type SettingKey = 'academy_profile' | 'billing_defaults' | 'reminder_defaults' | 'channels_config';

type SettingRow = {
  key: SettingKey;
  value: unknown;
  updated_by: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  actor: string;
  action: string;
  section: string;
  details: unknown;
  created_at: string;
};

export type AcademyProfileSettings = {
  academyName: string;
  divisionLine: string;
  tagline: string;
  contactEmail: string;
  contactPhone: string;
  addressLine: string;
  currency: string;
  timezone: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
};

export type BillingDefaultsSettings = {
  registrationFee: number;
  monthlyFee: number;
  dueDayOfMonth: number;
  invoiceGraceDays: number;
  defaultCurrency: string;
};

export type ReminderDefaultsSettings = {
  beforeDueDays: number;
  overdueDays: number;
  enableEmail: boolean;
  enableWhatsApp: boolean;
};

export type ChannelsSettings = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  emailFrom: string;
  smtpSimulate: boolean;
  whatsappApiUrl: string;
  whatsappApiToken: string;
  whatsappDefaultSender: string;
  whatsappSimulate: boolean;
};

export type ChannelsDeliveryConfig = {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure: boolean;
  smtpUser?: string;
  smtpPass?: string;
  emailFrom: string;
  smtpSimulate: boolean;
  whatsappApiUrl?: string;
  whatsappApiToken?: string;
  whatsappDefaultSender?: string;
  whatsappSimulate: boolean;
};

export type SettingsAuditEntry = {
  id: string;
  actor: string;
  action: string;
  section: string;
  details: unknown;
  createdAt: string;
};

const DEFAULT_ACADEMY_PROFILE: AcademyProfileSettings = {
  academyName: 'Dynaverse Football Academy',
  divisionLine: 'A Division of Dynaverse Investments',
  tagline: 'Building Character - Developing Talent - Future Professionals',
  contactEmail: env.ACADEMY_CONTACT_EMAIL,
  contactPhone: env.ACADEMY_CONTACT_PHONE,
  addressLine: 'Windhoek, Namibia',
  currency: env.DEFAULT_CURRENCY,
  timezone: 'Africa/Windhoek',
  bankName: env.BANK_NAME,
  bankAccountName: env.BANK_ACCOUNT_NAME,
  bankAccountNumber: env.BANK_ACCOUNT_NUMBER
};

const DEFAULT_BILLING_DEFAULTS: BillingDefaultsSettings = {
  registrationFee: 50,
  monthlyFee: 250,
  dueDayOfMonth: 5,
  invoiceGraceDays: 7,
  defaultCurrency: env.DEFAULT_CURRENCY
};

const DEFAULT_REMINDER_DEFAULTS: ReminderDefaultsSettings = {
  beforeDueDays: 3,
  overdueDays: 3,
  enableEmail: true,
  enableWhatsApp: true
};

const DEFAULT_CHANNELS: ChannelsSettings = {
  smtpHost: env.SMTP_HOST ?? '',
  smtpPort: env.SMTP_PORT ?? 587,
  smtpSecure: env.SMTP_SECURE ?? false,
  smtpUser: env.SMTP_USER ?? '',
  smtpPass: env.SMTP_PASS ?? '',
  emailFrom: env.EMAIL_FROM,
  smtpSimulate: env.SMTP_SIMULATE,
  whatsappApiUrl: env.WHATSAPP_API_URL ?? '',
  whatsappApiToken: env.WHATSAPP_API_TOKEN ?? '',
  whatsappDefaultSender: env.WHATSAPP_DEFAULT_SENDER ?? '',
  whatsappSimulate: env.WHATSAPP_SIMULATE
};

let ensurePromise: Promise<void> | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function cleanedOptional(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function ensureSettingsInfrastructure(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_by TEXT NOT NULL DEFAULT 'system',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS system_audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          section TEXT NOT NULL,
          details JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_system_audit_logs_created_at
        ON system_audit_logs (created_at DESC)
      `);

      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'system')
         ON CONFLICT (key) DO NOTHING`,
        ['academy_profile', JSON.stringify(DEFAULT_ACADEMY_PROFILE)]
      );
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'system')
         ON CONFLICT (key) DO NOTHING`,
        ['billing_defaults', JSON.stringify(DEFAULT_BILLING_DEFAULTS)]
      );
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'system')
         ON CONFLICT (key) DO NOTHING`,
        ['reminder_defaults', JSON.stringify(DEFAULT_REMINDER_DEFAULTS)]
      );
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'system')
         ON CONFLICT (key) DO NOTHING`,
        ['channels_config', JSON.stringify(DEFAULT_CHANNELS)]
      );
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  await ensurePromise;
}

async function getSettingRow(key: SettingKey): Promise<SettingRow | null> {
  await ensureSettingsInfrastructure();
  const result = await pool.query<SettingRow>(
    `
      SELECT key, value, updated_by, updated_at::text
      FROM system_settings
      WHERE key = $1
      LIMIT 1
    `,
    [key]
  );
  return result.rows[0] ?? null;
}

export async function upsertSystemSetting(
  key: SettingKey,
  value: unknown,
  actor: string,
  action = 'settings.updated'
): Promise<void> {
  await ensureSettingsInfrastructure();
  await pool.query(
    `
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES ($1, $2::jsonb, $3, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
    `,
    [key, JSON.stringify(value), actor]
  );
  await appendAuditLog(actor, action, key, { key });
}

export async function appendAuditLog(
  actor: string,
  action: string,
  section: string,
  details: unknown
): Promise<void> {
  await ensureSettingsInfrastructure();
  await pool.query(
    `
      INSERT INTO system_audit_logs (actor, action, section, details)
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [actor, action, section, JSON.stringify(details ?? {})]
  );
}

export async function listAuditEntries(limit = 50): Promise<SettingsAuditEntry[]> {
  await ensureSettingsInfrastructure();
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
  const result = await pool.query<AuditRow>(
    `
      SELECT id, actor, action, section, details, created_at::text
      FROM system_audit_logs
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [normalizedLimit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    action: row.action,
    section: row.section,
    details: row.details,
    createdAt: row.created_at
  }));
}

export async function getAcademyProfileSettings(): Promise<AcademyProfileSettings> {
  const row = await getSettingRow('academy_profile');
  const value = asRecord(row?.value);
  return {
    academyName: asString(value.academyName, DEFAULT_ACADEMY_PROFILE.academyName),
    divisionLine: asString(value.divisionLine, DEFAULT_ACADEMY_PROFILE.divisionLine),
    tagline: asString(value.tagline, DEFAULT_ACADEMY_PROFILE.tagline),
    contactEmail: asString(value.contactEmail, DEFAULT_ACADEMY_PROFILE.contactEmail),
    contactPhone: asString(value.contactPhone, DEFAULT_ACADEMY_PROFILE.contactPhone),
    addressLine: asString(value.addressLine, DEFAULT_ACADEMY_PROFILE.addressLine),
    currency: asString(value.currency, DEFAULT_ACADEMY_PROFILE.currency),
    timezone: asString(value.timezone, DEFAULT_ACADEMY_PROFILE.timezone),
    bankName: asString(value.bankName, DEFAULT_ACADEMY_PROFILE.bankName),
    bankAccountName: asString(value.bankAccountName, DEFAULT_ACADEMY_PROFILE.bankAccountName),
    bankAccountNumber: asString(value.bankAccountNumber, DEFAULT_ACADEMY_PROFILE.bankAccountNumber)
  };
}

export async function getBillingDefaultsSettings(): Promise<BillingDefaultsSettings> {
  const row = await getSettingRow('billing_defaults');
  const value = asRecord(row?.value);

  const feePlans = await pool.query<{ code: string; amount: string; currency: string }>(
    `
      SELECT code, amount::text, currency
      FROM fee_plans
      WHERE code IN ('REGISTRATION_ONCE', 'MONTHLY_SUBSCRIPTION')
    `
  );

  const registrationPlan = feePlans.rows.find((item) => item.code === 'REGISTRATION_ONCE');
  const monthlyPlan = feePlans.rows.find((item) => item.code === 'MONTHLY_SUBSCRIPTION');

  return {
    registrationFee: registrationPlan
      ? Number(registrationPlan.amount)
      : asNumber(value.registrationFee, DEFAULT_BILLING_DEFAULTS.registrationFee),
    monthlyFee: monthlyPlan
      ? Number(monthlyPlan.amount)
      : asNumber(value.monthlyFee, DEFAULT_BILLING_DEFAULTS.monthlyFee),
    dueDayOfMonth: Math.min(Math.max(asNumber(value.dueDayOfMonth, DEFAULT_BILLING_DEFAULTS.dueDayOfMonth), 1), 28),
    invoiceGraceDays: Math.min(Math.max(asNumber(value.invoiceGraceDays, DEFAULT_BILLING_DEFAULTS.invoiceGraceDays), 1), 60),
    defaultCurrency: registrationPlan?.currency ?? monthlyPlan?.currency ?? asString(value.defaultCurrency, DEFAULT_BILLING_DEFAULTS.defaultCurrency)
  };
}

export async function getReminderDefaultsSettings(): Promise<ReminderDefaultsSettings> {
  const row = await getSettingRow('reminder_defaults');
  const value = asRecord(row?.value);

  const rules = await pool.query<{ trigger_type: string; offset_days: number; channel: string; is_active: boolean }>(
    `
      SELECT trigger_type::text, offset_days, channel::text, is_active
      FROM reminder_rules
      WHERE trigger_type IN ('before_due', 'overdue')
    `
  );

  const beforeDueRule = rules.rows.find((item) => item.trigger_type === 'before_due');
  const overdueRule = rules.rows.find((item) => item.trigger_type === 'overdue');
  const emailRules = rules.rows.filter((item) => item.channel === 'email');

  return {
    beforeDueDays: beforeDueRule?.offset_days ?? asNumber(value.beforeDueDays, DEFAULT_REMINDER_DEFAULTS.beforeDueDays),
    overdueDays: overdueRule?.offset_days ?? asNumber(value.overdueDays, DEFAULT_REMINDER_DEFAULTS.overdueDays),
    enableEmail:
      emailRules.length > 0
        ? emailRules.some((item) => item.is_active)
        : asBoolean(value.enableEmail, DEFAULT_REMINDER_DEFAULTS.enableEmail),
    enableWhatsApp: asBoolean(value.enableWhatsApp, DEFAULT_REMINDER_DEFAULTS.enableWhatsApp)
  };
}

function channelsFromRecord(record: Record<string, unknown>): ChannelsSettings {
  return {
    smtpHost: asString(record.smtpHost, DEFAULT_CHANNELS.smtpHost),
    smtpPort: asNumber(record.smtpPort, DEFAULT_CHANNELS.smtpPort),
    smtpSecure: asBoolean(record.smtpSecure, DEFAULT_CHANNELS.smtpSecure),
    smtpUser: asString(record.smtpUser, DEFAULT_CHANNELS.smtpUser),
    smtpPass: asString(record.smtpPass, DEFAULT_CHANNELS.smtpPass),
    emailFrom: asString(record.emailFrom, DEFAULT_CHANNELS.emailFrom),
    smtpSimulate: asBoolean(record.smtpSimulate, DEFAULT_CHANNELS.smtpSimulate),
    whatsappApiUrl: asString(record.whatsappApiUrl, DEFAULT_CHANNELS.whatsappApiUrl),
    whatsappApiToken: asString(record.whatsappApiToken, DEFAULT_CHANNELS.whatsappApiToken),
    whatsappDefaultSender: asString(record.whatsappDefaultSender, DEFAULT_CHANNELS.whatsappDefaultSender),
    whatsappSimulate: asBoolean(record.whatsappSimulate, DEFAULT_CHANNELS.whatsappSimulate)
  };
}

export async function getChannelsSettings(): Promise<ChannelsSettings> {
  const row = await getSettingRow('channels_config');
  return channelsFromRecord(asRecord(row?.value));
}

export async function getChannelsDeliveryConfig(): Promise<ChannelsDeliveryConfig> {
  const channels = await getChannelsSettings();
  return {
    smtpHost: cleanedOptional(channels.smtpHost) ?? env.SMTP_HOST,
    smtpPort: channels.smtpPort || env.SMTP_PORT,
    smtpSecure: channels.smtpSecure,
    smtpUser: cleanedOptional(channels.smtpUser) ?? env.SMTP_USER,
    smtpPass: cleanedOptional(channels.smtpPass) ?? env.SMTP_PASS,
    emailFrom: cleanedOptional(channels.emailFrom) ?? env.EMAIL_FROM,
    smtpSimulate: channels.smtpSimulate,
    whatsappApiUrl: cleanedOptional(channels.whatsappApiUrl) ?? env.WHATSAPP_API_URL,
    whatsappApiToken: cleanedOptional(channels.whatsappApiToken) ?? env.WHATSAPP_API_TOKEN,
    whatsappDefaultSender: cleanedOptional(channels.whatsappDefaultSender) ?? env.WHATSAPP_DEFAULT_SENDER,
    whatsappSimulate: channels.whatsappSimulate
  };
}

export function sanitizeChannelsForClient(channels: ChannelsSettings): Record<string, unknown> {
  const smtpConfigured = Boolean(
    cleanedOptional(channels.smtpHost) &&
      channels.smtpPort &&
      cleanedOptional(channels.smtpUser) &&
      cleanedOptional(channels.smtpPass)
  );
  const whatsappConfigured = Boolean(
    cleanedOptional(channels.whatsappApiUrl) && cleanedOptional(channels.whatsappApiToken)
  );
  return {
    smtpHost: channels.smtpHost,
    smtpPort: channels.smtpPort,
    smtpSecure: channels.smtpSecure,
    smtpUser: channels.smtpUser,
    smtpPassSet: cleanedOptional(channels.smtpPass) ? true : false,
    emailFrom: channels.emailFrom,
    smtpSimulate: channels.smtpSimulate,
    smtpConfigured,
    whatsappApiUrl: channels.whatsappApiUrl,
    whatsappApiTokenSet: cleanedOptional(channels.whatsappApiToken) ? true : false,
    whatsappDefaultSender: channels.whatsappDefaultSender,
    whatsappSimulate: channels.whatsappSimulate,
    whatsappConfigured
  };
}

