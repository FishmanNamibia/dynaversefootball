import dayjs from 'dayjs';
import { pool } from '../../db/pool.js';
import { sendEmailMessage, sendWhatsAppMessage } from '../../integrations/messaging.js';
import { HttpError } from '../../utils/httpError.js';
import { getAcademyProfileSettings } from '../settings/settings.store.js';

export type ReminderStage = 'stage_1' | 'stage_2' | 'stage_3' | 'final' | 'none';
export type ReminderChannel = 'email' | 'whatsapp' | 'both';
export type CollectionStatus = 'overdue' | 'due_this_week' | 'current' | 'paid';

type PendingReminderRow = {
  reminder_event_id: string;
  scheduled_for: string;
  channel: string;
  trigger_type: string;
  template_key: string;
  invoice_id: string;
  invoice_number: string;
  due_date: string;
  total_amount: string;
  currency: string;
  player_id: string;
  player_code: string;
  player_name: string;
  guardian_id: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
};

type CollectionAccountRow = {
  guardian_id: string;
  guardian_name: string;
  guardian_email: string | null;
  guardian_phone: string | null;
  player_names: string;
  open_invoices_count: number;
  total_outstanding: string;
  oldest_due_date: string | null;
  latest_due_date: string | null;
  currency: string | null;
  last_reminder_sent_at: string | null;
};

type AccountInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  player_id: string;
  player_code: string;
  player_name: string;
  issue_date: string;
  due_date: string;
  invoice_status: string;
  currency: string;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  line_summary: string | null;
};

type AccountPaymentRow = {
  payment_id: string;
  received_on: string;
  method: string;
  amount: string;
  currency: string;
  payment_reference: string | null;
  external_reference: string | null;
  player_code: string;
  player_name: string;
};

type AccountPlayerRow = {
  player_id: string;
  player_code: string;
  player_name: string;
};

type ReminderHistoryRow = {
  id: string;
  stage: string;
  channel: string;
  status: string;
  message_snapshot: string;
  sent_at: string;
  provider_message_id: string | null;
  actor: string | null;
  invoice_id: string | null;
  player_id: string | null;
};

type ContactNoteRow = {
  id: string;
  note: string;
  created_by: string;
  created_at: string;
};

type GuardianIdentityRow = {
  guardian_id: string;
  guardian_name: string;
  guardian_email: string | null;
  guardian_phone: string | null;
};

export type CollectionAccount = {
  guardianId: string;
  guardianName: string;
  guardianEmail: string | null;
  guardianPhone: string | null;
  playerNames: string[];
  openInvoicesCount: number;
  totalOutstanding: number;
  currency: string;
  oldestDueDate: string | null;
  latestDueDate: string | null;
  daysOverdue: number;
  daysUntilDue: number | null;
  lastReminderSentAt: string | null;
  reminderStage: ReminderStage;
  reminderStageLabel: string;
  status: CollectionStatus;
  statusLabel: string;
  nextReminderDue: string | null;
};

type ReminderHistoryInsert = {
  guardianId: string | null;
  playerId: string | null;
  invoiceId: string | null;
  stage: ReminderStage;
  channel: string;
  status: string;
  messageSnapshot: string;
  actor: string;
  providerMessageId?: string;
  meta?: Record<string, unknown>;
};

const INVOICE_BALANCES_CTE = `
  WITH invoice_balances AS (
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.player_id,
      COALESCE(i.billing_guardian_id, pg.guardian_id) AS guardian_id,
      i.issue_date,
      i.due_date,
      i.status::text AS invoice_status,
      i.currency,
      i.total_amount::numeric AS total_amount,
      COALESCE(SUM(pa.amount_allocated), 0)::numeric AS paid_amount,
      (i.total_amount - COALESCE(SUM(pa.amount_allocated), 0))::numeric AS outstanding_amount
    FROM invoices i
    LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
    LEFT JOIN LATERAL (
      SELECT guardian_id
      FROM player_guardians x
      WHERE x.player_id = i.player_id
      ORDER BY x.is_billing_contact DESC, x.is_primary_contact DESC, x.created_at ASC
      LIMIT 1
    ) pg ON TRUE
    GROUP BY i.id, pg.guardian_id
  )
`;

let ensureCollectionsPromise: Promise<void> | null = null;

function normalizeActor(actor: string | undefined): string {
  const cleaned = (actor ?? '').trim();
  return cleaned.length > 0 ? cleaned : 'system';
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function splitPlayerNames(value: string): string[] {
  return value
    .split('||')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function stageLabel(stage: ReminderStage): string {
  if (stage === 'stage_1') return 'Stage 1';
  if (stage === 'stage_2') return 'Stage 2';
  if (stage === 'stage_3') return 'Stage 3';
  if (stage === 'final') return 'Final Notice';
  return 'None';
}

function statusLabel(status: CollectionStatus): string {
  if (status === 'overdue') return 'Overdue';
  if (status === 'due_this_week') return 'Due This Week';
  if (status === 'current') return 'Current';
  return 'Fully Paid';
}

function stageFromTrigger(triggerType: string, dueDate: string): ReminderStage {
  if (triggerType === 'before_due') return 'stage_1';
  if (triggerType === 'on_due') return 'stage_1';
  if (triggerType === 'overdue') {
    const daysOverdue = Math.max(dayjs().startOf('day').diff(dayjs(dueDate).startOf('day'), 'day'), 0);
    if (daysOverdue >= 14) return 'final';
    if (daysOverdue >= 7) return 'stage_3';
    return 'stage_2';
  }
  return 'none';
}

function classifyAccount(oldestDueDate: string | null, totalOutstanding: number): {
  status: CollectionStatus;
  stage: ReminderStage;
  daysOverdue: number;
  daysUntilDue: number | null;
  nextReminderDue: string | null;
} {
  if (totalOutstanding <= 0) {
    return {
      status: 'paid',
      stage: 'none',
      daysOverdue: 0,
      daysUntilDue: null,
      nextReminderDue: null
    };
  }

  if (!oldestDueDate) {
    return {
      status: 'current',
      stage: 'none',
      daysOverdue: 0,
      daysUntilDue: null,
      nextReminderDue: null
    };
  }

  const today = dayjs().startOf('day');
  const due = dayjs(oldestDueDate).startOf('day');
  if (!due.isValid()) {
    return {
      status: 'current',
      stage: 'none',
      daysOverdue: 0,
      daysUntilDue: null,
      nextReminderDue: null
    };
  }

  if (due.isBefore(today)) {
    const daysOverdue = today.diff(due, 'day');
    if (daysOverdue >= 14) {
      return {
        status: 'overdue',
        stage: 'final',
        daysOverdue,
        daysUntilDue: null,
        nextReminderDue: null
      };
    }
    if (daysOverdue >= 7) {
      return {
        status: 'overdue',
        stage: 'stage_3',
        daysOverdue,
        daysUntilDue: null,
        nextReminderDue: due.add(14, 'day').format('YYYY-MM-DD')
      };
    }
    if (daysOverdue >= 3) {
      return {
        status: 'overdue',
        stage: 'stage_2',
        daysOverdue,
        daysUntilDue: null,
        nextReminderDue: due.add(7, 'day').format('YYYY-MM-DD')
      };
    }
    return {
      status: 'overdue',
      stage: 'stage_1',
      daysOverdue,
      daysUntilDue: null,
      nextReminderDue: due.add(3, 'day').format('YYYY-MM-DD')
    };
  }

  const daysUntilDue = due.diff(today, 'day');
  if (daysUntilDue <= 7) {
    return {
      status: 'due_this_week',
      stage: daysUntilDue <= 3 ? 'stage_1' : 'none',
      daysOverdue: 0,
      daysUntilDue,
      nextReminderDue: due.subtract(3, 'day').format('YYYY-MM-DD')
    };
  }

  return {
    status: 'current',
    stage: 'none',
    daysOverdue: 0,
    daysUntilDue,
    nextReminderDue: null
  };
}

function buildPersonalizedReminderMessage(input: {
  guardianName: string;
  playerNames: string[];
  stage: ReminderStage;
  currency: string;
  totalOutstanding: number;
  oldestDueDate: string | null;
  daysOverdue: number;
  invoiceNumbers: string[];
  paymentReference: string;
}): string {
  const greetingName = input.guardianName || 'Parent/Guardian';
  const playerText = input.playerNames.length > 0 ? input.playerNames.join(', ') : 'your player';
  const stageTone =
    input.stage === 'stage_1'
      ? 'friendly reminder'
      : input.stage === 'stage_2'
        ? 'polite follow-up'
        : input.stage === 'stage_3'
          ? 'important overdue notice'
          : input.stage === 'final'
            ? 'final notice before possible training suspension'
            : 'payment reminder';
  const dueLine = input.oldestDueDate
    ? input.daysOverdue > 0
      ? `Oldest due date: ${dayjs(input.oldestDueDate).format('DD MMMM YYYY')} (${input.daysOverdue} day(s) overdue).`
      : `Due date: ${dayjs(input.oldestDueDate).format('DD MMMM YYYY')}.`
    : 'Please check your current fee schedule.';
  const invoiceLine =
    input.invoiceNumbers.length > 0
      ? `Open invoice(s): ${input.invoiceNumbers.slice(0, 5).join(', ')}.`
      : 'Open academy invoice(s) are pending payment.';

  return (
    `Good day ${greetingName},\n` +
    `This is a ${stageTone} for ${playerText} at Dynaverse Football Academy.\n` +
    `Total outstanding balance: ${input.currency} ${input.totalOutstanding.toFixed(2)}.\n` +
    `${dueLine}\n` +
    `${invoiceLine}\n` +
    `Kindly use payment reference ${input.paymentReference} when paying.\n` +
    `Thank you.`
  );
}

async function ensureCollectionsInfrastructure(): Promise<void> {
  if (!ensureCollectionsPromise) {
    ensureCollectionsPromise = (async () => {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS reminder_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guardian_id UUID REFERENCES guardians(id) ON DELETE SET NULL,
          player_id UUID REFERENCES players(id) ON DELETE SET NULL,
          invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
          stage TEXT NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL,
          message_snapshot TEXT NOT NULL,
          provider_message_id TEXT,
          actor TEXT NOT NULL DEFAULT 'system',
          meta JSONB,
          sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS guardian_contact_notes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
          note TEXT NOT NULL,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_reminder_history_guardian_sent_at
        ON reminder_history (guardian_id, sent_at DESC)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_guardian_contact_notes_guardian_created_at
        ON guardian_contact_notes (guardian_id, created_at DESC)
      `);
    })().catch((error) => {
      ensureCollectionsPromise = null;
      throw error;
    });
  }

  await ensureCollectionsPromise;
}

async function logReminderHistory(input: ReminderHistoryInsert): Promise<void> {
  await ensureCollectionsInfrastructure();
  await pool.query(
    `
      INSERT INTO reminder_history (
        guardian_id,
        player_id,
        invoice_id,
        stage,
        channel,
        status,
        message_snapshot,
        provider_message_id,
        actor,
        meta
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `,
    [
      input.guardianId,
      input.playerId,
      input.invoiceId,
      input.stage,
      input.channel,
      input.status,
      input.messageSnapshot,
      input.providerMessageId ?? null,
      input.actor,
      JSON.stringify(input.meta ?? {})
    ]
  );
}

async function queryCollectionAccounts(limit: number, status?: CollectionStatus): Promise<CollectionAccount[]> {
  await ensureCollectionsInfrastructure();
  const normalizedLimit = Math.min(Math.max(limit, 1), 500);
  const rows = await pool.query<CollectionAccountRow>(
    `
      ${INVOICE_BALANCES_CTE}
      ,
      guardian_accounts AS (
        SELECT
          g.id AS guardian_id,
          CONCAT(g.first_name, ' ', g.last_name) AS guardian_name,
          NULLIF(TRIM(g.email), '') AS guardian_email,
          NULLIF(TRIM(g.phone_whatsapp), '') AS guardian_phone,
          COALESCE(string_agg(DISTINCT CONCAT(p.first_name, ' ', p.last_name), '||'), '') AS player_names
        FROM guardians g
        INNER JOIN player_guardians pg ON pg.guardian_id = g.id
        INNER JOIN players p ON p.id = pg.player_id
        GROUP BY g.id, g.first_name, g.last_name, g.email, g.phone_whatsapp
      ),
      open_by_guardian AS (
        SELECT
          guardian_id,
          COUNT(*)::int AS open_invoices_count,
          COALESCE(SUM(outstanding_amount), 0)::text AS total_outstanding,
          MIN(due_date)::text AS oldest_due_date,
          MAX(due_date)::text AS latest_due_date,
          MIN(currency) AS currency
        FROM invoice_balances
        WHERE guardian_id IS NOT NULL AND outstanding_amount > 0
        GROUP BY guardian_id
      ),
      last_history AS (
        SELECT guardian_id, MAX(sent_at)::text AS last_reminder_sent_at
        FROM reminder_history
        WHERE guardian_id IS NOT NULL
        GROUP BY guardian_id
      )
      SELECT
        ga.guardian_id,
        ga.guardian_name,
        ga.guardian_email,
        ga.guardian_phone,
        ga.player_names,
        COALESCE(obg.open_invoices_count, 0) AS open_invoices_count,
        COALESCE(obg.total_outstanding, '0') AS total_outstanding,
        obg.oldest_due_date,
        obg.latest_due_date,
        COALESCE(obg.currency, 'NAD') AS currency,
        lh.last_reminder_sent_at
      FROM guardian_accounts ga
      LEFT JOIN open_by_guardian obg ON obg.guardian_id = ga.guardian_id
      LEFT JOIN last_history lh ON lh.guardian_id = ga.guardian_id
      ORDER BY COALESCE(obg.total_outstanding::numeric, 0) DESC, ga.guardian_name ASC
      LIMIT $1
    `,
    [normalizedLimit]
  );

  const mapped = rows.rows.map((row) => {
    const totalOutstanding = Number(row.total_outstanding);
    const classification = classifyAccount(row.oldest_due_date, totalOutstanding);
    return {
      guardianId: row.guardian_id,
      guardianName: row.guardian_name,
      guardianEmail: cleanText(row.guardian_email),
      guardianPhone: cleanText(row.guardian_phone),
      playerNames: splitPlayerNames(row.player_names),
      openInvoicesCount: Number(row.open_invoices_count || 0),
      totalOutstanding,
      currency: row.currency ?? 'NAD',
      oldestDueDate: row.oldest_due_date,
      latestDueDate: row.latest_due_date,
      daysOverdue: classification.daysOverdue,
      daysUntilDue: classification.daysUntilDue,
      lastReminderSentAt: row.last_reminder_sent_at,
      reminderStage: classification.stage,
      reminderStageLabel: stageLabel(classification.stage),
      status: classification.status,
      statusLabel: statusLabel(classification.status),
      nextReminderDue: classification.nextReminderDue
    } satisfies CollectionAccount;
  });

  if (!status) {
    return mapped;
  }
  return mapped.filter((item) => item.status === status);
}

export async function listPendingReminders(limit = 100): Promise<PendingReminderRow[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 500);
  const result = await pool.query<PendingReminderRow>(
    `
      SELECT
        re.id AS reminder_event_id,
        re.scheduled_for::text,
        rr.channel::text,
        rr.trigger_type::text,
        rr.template_key,
        i.id AS invoice_id,
        i.invoice_number,
        i.due_date::text,
        i.total_amount::text,
        i.currency,
        p.id AS player_id,
        p.player_code,
        CONCAT(p.first_name, ' ', p.last_name) AS player_name,
        COALESCE(i.billing_guardian_id, pg.guardian_id) AS guardian_id,
        COALESCE(CONCAT(bg.first_name, ' ', bg.last_name), CONCAT(g.first_name, ' ', g.last_name)) AS guardian_name,
        COALESCE(bg.email, g.email) AS guardian_email,
        COALESCE(bg.phone_whatsapp, g.phone_whatsapp) AS guardian_phone
      FROM reminder_events re
      INNER JOIN reminder_rules rr ON rr.id = re.reminder_rule_id
      INNER JOIN invoices i ON i.id = re.invoice_id
      INNER JOIN players p ON p.id = i.player_id
      LEFT JOIN guardians bg ON bg.id = i.billing_guardian_id
      LEFT JOIN LATERAL (
        SELECT x.guardian_id
        FROM player_guardians x
        WHERE x.player_id = p.id
        ORDER BY x.is_billing_contact DESC, x.is_primary_contact DESC, x.created_at ASC
        LIMIT 1
      ) pg ON TRUE
      LEFT JOIN guardians g ON g.id = pg.guardian_id
      WHERE re.status = 'pending'
      ORDER BY re.scheduled_for ASC
      LIMIT $1
    `,
    [normalizedLimit]
  );
  return result.rows;
}

export async function dispatchDueReminders(limit = 100): Promise<{
  sent: number;
  failed: number;
}> {
  await ensureCollectionsInfrastructure();
  const dueReminders = await pool.query<PendingReminderRow>(
    `
      SELECT
        re.id AS reminder_event_id,
        re.scheduled_for::text,
        rr.channel::text,
        rr.trigger_type::text,
        rr.template_key,
        i.id AS invoice_id,
        i.invoice_number,
        i.due_date::text,
        i.total_amount::text,
        i.currency,
        p.id AS player_id,
        p.player_code,
        CONCAT(p.first_name, ' ', p.last_name) AS player_name,
        COALESCE(i.billing_guardian_id, pg.guardian_id) AS guardian_id,
        COALESCE(CONCAT(bg.first_name, ' ', bg.last_name), CONCAT(g.first_name, ' ', g.last_name)) AS guardian_name,
        COALESCE(bg.email, g.email) AS guardian_email,
        COALESCE(bg.phone_whatsapp, g.phone_whatsapp) AS guardian_phone
      FROM reminder_events re
      INNER JOIN reminder_rules rr ON rr.id = re.reminder_rule_id
      INNER JOIN invoices i ON i.id = re.invoice_id
      INNER JOIN players p ON p.id = i.player_id
      LEFT JOIN guardians bg ON bg.id = i.billing_guardian_id
      LEFT JOIN LATERAL (
        SELECT x.guardian_id
        FROM player_guardians x
        WHERE x.player_id = p.id
        ORDER BY x.is_billing_contact DESC, x.is_primary_contact DESC, x.created_at ASC
        LIMIT 1
      ) pg ON TRUE
      LEFT JOIN guardians g ON g.id = pg.guardian_id
      WHERE
        re.status = 'pending'
        AND re.scheduled_for <= NOW()
      ORDER BY re.scheduled_for ASC
      LIMIT $1
    `,
    [Math.min(Math.max(limit, 1), 500)]
  );

  let sent = 0;
  let failed = 0;

  for (const row of dueReminders.rows) {
    const stage = stageFromTrigger(row.trigger_type, row.due_date);
    const message = buildPersonalizedReminderMessage({
      guardianName: row.guardian_name ?? 'Parent/Guardian',
      playerNames: [row.player_name],
      stage,
      currency: row.currency,
      totalOutstanding: Number(row.total_amount),
      oldestDueDate: row.due_date,
      daysOverdue: Math.max(dayjs().startOf('day').diff(dayjs(row.due_date).startOf('day'), 'day'), 0),
      invoiceNumbers: [row.invoice_number],
      paymentReference: row.player_code
    });

    if (row.channel === 'email') {
      if (!row.guardian_email) {
        await pool.query(
          `
            UPDATE reminder_events
            SET
              status = 'failed',
              error_message = 'No billing email available',
              payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
            WHERE id = $1
          `,
          [row.reminder_event_id, JSON.stringify({ reason: 'missing_email' })]
        );
        await logReminderHistory({
          guardianId: row.guardian_id,
          playerId: row.player_id,
          invoiceId: row.invoice_id,
          stage,
          channel: 'email',
          status: 'failed',
          messageSnapshot: message,
          actor: 'scheduler',
          meta: { reason: 'missing_email' }
        });
        failed += 1;
        continue;
      }

      const delivery = await sendEmailMessage({
        to: row.guardian_email,
        subject: `Fee Reminder - ${row.invoice_number}`,
        text: message
      });

      if (!delivery.success) {
        await pool.query(
          `
            UPDATE reminder_events
            SET
              status = 'failed',
              error_message = $2,
              payload = COALESCE(payload, '{}'::jsonb)
            WHERE id = $1
          `,
          [row.reminder_event_id, delivery.error ?? 'email delivery failed']
        );
        await logReminderHistory({
          guardianId: row.guardian_id,
          playerId: row.player_id,
          invoiceId: row.invoice_id,
          stage,
          channel: 'email',
          status: 'failed',
          messageSnapshot: message,
          actor: 'scheduler',
          meta: { error: delivery.error ?? 'email delivery failed' }
        });
        failed += 1;
        continue;
      }

      await pool.query(
        `
          UPDATE reminder_events
          SET
            status = 'sent',
            sent_at = NOW(),
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
          WHERE id = $1
        `,
        [
          row.reminder_event_id,
          JSON.stringify({
            simulated: delivery.simulated,
            providerMessageId: delivery.providerMessageId,
            delivery: { channel: 'email', to: row.guardian_email, body: message }
          })
        ]
      );
      await logReminderHistory({
        guardianId: row.guardian_id,
        playerId: row.player_id,
        invoiceId: row.invoice_id,
        stage,
        channel: 'email',
        status: delivery.simulated ? 'simulated' : 'sent',
        messageSnapshot: message,
        providerMessageId: delivery.providerMessageId,
        actor: 'scheduler',
        meta: { simulated: delivery.simulated }
      });
      sent += 1;
      continue;
    }

    if (!row.guardian_phone) {
      await pool.query(
        `
          UPDATE reminder_events
          SET
            status = 'failed',
            error_message = 'No WhatsApp phone available',
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
          WHERE id = $1
        `,
        [row.reminder_event_id, JSON.stringify({ reason: 'missing_phone' })]
      );
      await logReminderHistory({
        guardianId: row.guardian_id,
        playerId: row.player_id,
        invoiceId: row.invoice_id,
        stage,
        channel: 'whatsapp',
        status: 'failed',
        messageSnapshot: message,
        actor: 'scheduler',
        meta: { reason: 'missing_phone' }
      });
      failed += 1;
      continue;
    }

    const delivery = await sendWhatsAppMessage({
      to: row.guardian_phone,
      message
    });
    if (!delivery.success) {
      await pool.query(
        `
          UPDATE reminder_events
          SET
            status = 'failed',
            error_message = $2,
            payload = COALESCE(payload, '{}'::jsonb)
          WHERE id = $1
        `,
        [row.reminder_event_id, delivery.error ?? 'whatsapp delivery failed']
      );
      await logReminderHistory({
        guardianId: row.guardian_id,
        playerId: row.player_id,
        invoiceId: row.invoice_id,
        stage,
        channel: 'whatsapp',
        status: 'failed',
        messageSnapshot: message,
        actor: 'scheduler',
        meta: { error: delivery.error ?? 'whatsapp delivery failed' }
      });
      failed += 1;
      continue;
    }

    await pool.query(
      `
        UPDATE reminder_events
        SET
          status = 'sent',
          sent_at = NOW(),
          payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
        WHERE id = $1
      `,
      [
        row.reminder_event_id,
        JSON.stringify({
          simulated: delivery.simulated,
          providerMessageId: delivery.providerMessageId,
          delivery: { channel: 'whatsapp', to: row.guardian_phone, body: message }
        })
      ]
    );
    await logReminderHistory({
      guardianId: row.guardian_id,
      playerId: row.player_id,
      invoiceId: row.invoice_id,
      stage,
      channel: 'whatsapp',
      status: delivery.simulated ? 'simulated' : 'sent',
      messageSnapshot: message,
      providerMessageId: delivery.providerMessageId,
      actor: 'scheduler',
      meta: { simulated: delivery.simulated }
    });
    sent += 1;
  }

  return { sent, failed };
}

export async function getCollectionsDashboard(limit = 200): Promise<{
  metrics: {
    guardiansOverdue: number;
    guardiansDueThisWeek: number;
    guardiansPaid: number;
    totalOutstanding: number;
    accountsInFinalStage: number;
  };
  overdueAccounts: CollectionAccount[];
  dueThisWeekAccounts: CollectionAccount[];
  fullyPaidAccounts: CollectionAccount[];
}> {
  const accounts = await queryCollectionAccounts(limit);
  const overdueAccounts = accounts.filter((item) => item.status === 'overdue');
  const dueThisWeekAccounts = accounts.filter((item) => item.status === 'due_this_week');
  const fullyPaidAccounts = accounts.filter((item) => item.status === 'paid');

  return {
    metrics: {
      guardiansOverdue: overdueAccounts.length,
      guardiansDueThisWeek: dueThisWeekAccounts.length,
      guardiansPaid: fullyPaidAccounts.length,
      totalOutstanding: accounts.reduce((sum, item) => sum + item.totalOutstanding, 0),
      accountsInFinalStage: overdueAccounts.filter((item) => item.reminderStage === 'final').length
    },
    overdueAccounts,
    dueThisWeekAccounts,
    fullyPaidAccounts
  };
}

export async function listCollectionAccounts(
  status: CollectionStatus | 'all' = 'all',
  limit = 200
): Promise<CollectionAccount[]> {
  if (status === 'all') {
    return queryCollectionAccounts(limit);
  }
  return queryCollectionAccounts(limit, status);
}

export async function getGuardianCollectionAccount(guardianId: string): Promise<{
  account: CollectionAccount;
  players: Array<{ playerId: string; playerCode: string; playerName: string }>;
  invoices: Array<{
    invoiceId: string;
    invoiceNumber: string;
    playerId: string;
    playerCode: string;
    playerName: string;
    issueDate: string;
    dueDate: string;
    status: string;
    currency: string;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    lineSummary: string | null;
  }>;
  payments: Array<{
    paymentId: string;
    receivedOn: string;
    method: string;
    amount: number;
    currency: string;
    paymentReference: string | null;
    externalReference: string | null;
    playerCode: string;
    playerName: string;
  }>;
  reminderHistory: Array<{
    id: string;
    stage: string;
    channel: string;
    status: string;
    messageSnapshot: string;
    sentAt: string;
    providerMessageId: string | null;
    actor: string | null;
    invoiceId: string | null;
    playerId: string | null;
  }>;
  contactNotes: Array<{
    id: string;
    note: string;
    createdBy: string;
    createdAt: string;
  }>;
}> {
  const accounts = await queryCollectionAccounts(500);
  const account = accounts.find((item) => item.guardianId === guardianId);
  if (!account) {
    throw new HttpError(404, 'Guardian account not found');
  }

  const [playersResult, invoicesResult, paymentsResult, historyResult, notesResult] = await Promise.all([
    pool.query<AccountPlayerRow>(
      `
        SELECT DISTINCT
          p.id AS player_id,
          p.player_code,
          CONCAT(p.first_name, ' ', p.last_name) AS player_name
        FROM player_guardians pg
        INNER JOIN players p ON p.id = pg.player_id
        WHERE pg.guardian_id = $1
        ORDER BY player_name ASC
      `,
      [guardianId]
    ),
    pool.query<AccountInvoiceRow>(
      `
        ${INVOICE_BALANCES_CTE}
        SELECT
          ib.invoice_id,
          ib.invoice_number,
          ib.player_id,
          p.player_code,
          CONCAT(p.first_name, ' ', p.last_name) AS player_name,
          ib.issue_date::text,
          ib.due_date::text,
          ib.invoice_status,
          ib.currency,
          ib.total_amount::text,
          ib.paid_amount::text,
          ib.outstanding_amount::text,
          NULLIF(string_agg(ii.description, ' | ' ORDER BY ii.created_at), '') AS line_summary
        FROM invoice_balances ib
        INNER JOIN players p ON p.id = ib.player_id
        LEFT JOIN invoice_items ii ON ii.invoice_id = ib.invoice_id
        WHERE ib.guardian_id = $1
        GROUP BY
          ib.invoice_id,
          ib.invoice_number,
          ib.player_id,
          p.player_code,
          p.first_name,
          p.last_name,
          ib.issue_date,
          ib.due_date,
          ib.invoice_status,
          ib.currency,
          ib.total_amount,
          ib.paid_amount,
          ib.outstanding_amount
        ORDER BY ib.due_date DESC, ib.invoice_number DESC
        LIMIT 120
      `,
      [guardianId]
    ),
    pool.query<AccountPaymentRow>(
      `
        SELECT
          p.id AS payment_id,
          p.received_on::text,
          p.method::text,
          p.amount::text,
          p.currency,
          p.payment_reference,
          p.external_reference,
          pl.player_code,
          CONCAT(pl.first_name, ' ', pl.last_name) AS player_name
        FROM payments p
        INNER JOIN players pl ON pl.id = p.player_id
        WHERE EXISTS (
          SELECT 1
          FROM player_guardians pg
          WHERE pg.player_id = pl.id AND pg.guardian_id = $1
        )
        ORDER BY p.received_on DESC, p.created_at DESC
        LIMIT 60
      `,
      [guardianId]
    ),
    pool.query<ReminderHistoryRow>(
      `
        SELECT
          id::text,
          stage,
          channel,
          status,
          message_snapshot,
          sent_at::text,
          provider_message_id,
          actor,
          invoice_id::text,
          player_id::text
        FROM reminder_history
        WHERE guardian_id = $1
        ORDER BY sent_at DESC
        LIMIT 120
      `,
      [guardianId]
    ),
    pool.query<ContactNoteRow>(
      `
        SELECT id::text, note, created_by, created_at::text
        FROM guardian_contact_notes
        WHERE guardian_id = $1
        ORDER BY created_at DESC
        LIMIT 60
      `,
      [guardianId]
    )
  ]);

  return {
    account,
    players: playersResult.rows.map((row) => ({
      playerId: row.player_id,
      playerCode: row.player_code,
      playerName: row.player_name
    })),
    invoices: invoicesResult.rows.map((row) => ({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      playerId: row.player_id,
      playerCode: row.player_code,
      playerName: row.player_name,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      status: row.invoice_status,
      currency: row.currency,
      totalAmount: Number(row.total_amount),
      paidAmount: Number(row.paid_amount),
      outstandingAmount: Number(row.outstanding_amount),
      lineSummary: row.line_summary
    })),
    payments: paymentsResult.rows.map((row) => ({
      paymentId: row.payment_id,
      receivedOn: row.received_on,
      method: row.method,
      amount: Number(row.amount),
      currency: row.currency,
      paymentReference: row.payment_reference,
      externalReference: row.external_reference,
      playerCode: row.player_code,
      playerName: row.player_name
    })),
    reminderHistory: historyResult.rows.map((row) => ({
      id: row.id,
      stage: row.stage,
      channel: row.channel,
      status: row.status,
      messageSnapshot: row.message_snapshot,
      sentAt: row.sent_at,
      providerMessageId: row.provider_message_id,
      actor: row.actor,
      invoiceId: row.invoice_id,
      playerId: row.player_id
    })),
    contactNotes: notesResult.rows.map((row) => ({
      id: row.id,
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at
    }))
  };
}

export async function sendCollectionReminderToGuardian(input: {
  guardianId: string;
  channel: ReminderChannel;
  stage?: ReminderStage;
  customMessage?: string;
  actor?: string;
}): Promise<{
  guardianId: string;
  guardianName: string;
  channel: ReminderChannel;
  stage: ReminderStage;
  totalOutstanding: number;
  sentEmail: number;
  sentWhatsApp: number;
  failed: number;
  simulated: number;
}> {
  await ensureCollectionsInfrastructure();
  const actor = normalizeActor(input.actor);
  const detail = await getGuardianCollectionAccount(input.guardianId);
  const openInvoices = detail.invoices.filter((item) => item.outstandingAmount > 0);
  if (openInvoices.length === 0 || detail.account.totalOutstanding <= 0) {
    throw new HttpError(400, 'Guardian has no outstanding balance');
  }

  const academy = await getAcademyProfileSettings();
  const stage =
    input.stage && input.stage !== 'none'
      ? input.stage
      : detail.account.reminderStage !== 'none'
        ? detail.account.reminderStage
        : 'stage_1';

  const message =
    cleanText(input.customMessage) ??
    buildPersonalizedReminderMessage({
      guardianName: detail.account.guardianName,
      playerNames: detail.account.playerNames,
      stage,
      currency: detail.account.currency,
      totalOutstanding: detail.account.totalOutstanding,
      oldestDueDate: detail.account.oldestDueDate,
      daysOverdue: detail.account.daysOverdue,
      invoiceNumbers: openInvoices.map((item) => item.invoiceNumber),
      paymentReference: openInvoices[0]?.playerCode ?? detail.players[0]?.playerCode ?? 'DYN-REF'
    });

  const firstInvoice = openInvoices[0];
  let sentEmail = 0;
  let sentWhatsApp = 0;
  let failed = 0;
  let simulated = 0;

  if (input.channel === 'email' || input.channel === 'both') {
    const email = cleanText(detail.account.guardianEmail);
    if (!email) {
      failed += 1;
      await logReminderHistory({
        guardianId: detail.account.guardianId,
        playerId: firstInvoice?.playerId ?? null,
        invoiceId: firstInvoice?.invoiceId ?? null,
        stage,
        channel: 'email',
        status: 'failed',
        messageSnapshot: message,
        actor,
        meta: { reason: 'missing_email' }
      });
    } else {
      const delivery = await sendEmailMessage({
        to: email,
        subject: `${academy.academyName} ${stageLabel(stage)} Fee Reminder`,
        text: message
      });
      if (delivery.success) {
        sentEmail += 1;
        if (delivery.simulated) {
          simulated += 1;
        }
        await logReminderHistory({
          guardianId: detail.account.guardianId,
          playerId: firstInvoice?.playerId ?? null,
          invoiceId: firstInvoice?.invoiceId ?? null,
          stage,
          channel: 'email',
          status: delivery.simulated ? 'simulated' : 'sent',
          messageSnapshot: message,
          providerMessageId: delivery.providerMessageId,
          actor,
          meta: { simulated: delivery.simulated, recipient: email }
        });
      } else {
        failed += 1;
        await logReminderHistory({
          guardianId: detail.account.guardianId,
          playerId: firstInvoice?.playerId ?? null,
          invoiceId: firstInvoice?.invoiceId ?? null,
          stage,
          channel: 'email',
          status: 'failed',
          messageSnapshot: message,
          actor,
          meta: { recipient: email, error: delivery.error ?? 'email delivery failed' }
        });
      }
    }
  }

  if (input.channel === 'whatsapp' || input.channel === 'both') {
    const phone = cleanText(detail.account.guardianPhone);
    if (!phone) {
      failed += 1;
      await logReminderHistory({
        guardianId: detail.account.guardianId,
        playerId: firstInvoice?.playerId ?? null,
        invoiceId: firstInvoice?.invoiceId ?? null,
        stage,
        channel: 'whatsapp',
        status: 'failed',
        messageSnapshot: message,
        actor,
        meta: { reason: 'missing_phone' }
      });
    } else {
      const delivery = await sendWhatsAppMessage({
        to: phone,
        message
      });
      if (delivery.success) {
        sentWhatsApp += 1;
        if (delivery.simulated) {
          simulated += 1;
        }
        await logReminderHistory({
          guardianId: detail.account.guardianId,
          playerId: firstInvoice?.playerId ?? null,
          invoiceId: firstInvoice?.invoiceId ?? null,
          stage,
          channel: 'whatsapp',
          status: delivery.simulated ? 'simulated' : 'sent',
          messageSnapshot: message,
          providerMessageId: delivery.providerMessageId,
          actor,
          meta: { simulated: delivery.simulated, recipient: phone }
        });
      } else {
        failed += 1;
        await logReminderHistory({
          guardianId: detail.account.guardianId,
          playerId: firstInvoice?.playerId ?? null,
          invoiceId: firstInvoice?.invoiceId ?? null,
          stage,
          channel: 'whatsapp',
          status: 'failed',
          messageSnapshot: message,
          actor,
          meta: { recipient: phone, error: delivery.error ?? 'whatsapp delivery failed' }
        });
      }
    }
  }

  return {
    guardianId: detail.account.guardianId,
    guardianName: detail.account.guardianName,
    channel: input.channel,
    stage,
    totalOutstanding: detail.account.totalOutstanding,
    sentEmail,
    sentWhatsApp,
    failed,
    simulated
  };
}

export async function sendBulkStageReminders(input: {
  stage: ReminderStage;
  channel: ReminderChannel;
  limit: number;
  actor?: string;
}): Promise<{
  stage: ReminderStage;
  channel: ReminderChannel;
  targets: number;
  processed: number;
  sentEmail: number;
  sentWhatsApp: number;
  failed: number;
  simulated: number;
}> {
  const candidates = await queryCollectionAccounts(Math.min(Math.max(input.limit * 3, input.limit), 500));
  const targets = candidates
    .filter((item) => item.totalOutstanding > 0 && item.reminderStage === input.stage)
    .slice(0, Math.min(Math.max(input.limit, 1), 500));

  let processed = 0;
  let sentEmail = 0;
  let sentWhatsApp = 0;
  let failed = 0;
  let simulated = 0;

  for (const account of targets) {
    const result = await sendCollectionReminderToGuardian({
      guardianId: account.guardianId,
      channel: input.channel,
      stage: input.stage,
      actor: input.actor
    });
    processed += 1;
    sentEmail += result.sentEmail;
    sentWhatsApp += result.sentWhatsApp;
    failed += result.failed;
    simulated += result.simulated;
  }

  return {
    stage: input.stage,
    channel: input.channel,
    targets: targets.length,
    processed,
    sentEmail,
    sentWhatsApp,
    failed,
    simulated
  };
}

export async function markGuardianAsContacted(
  guardianId: string,
  note: string,
  actor: string | undefined
): Promise<{ guardianId: string; noteId: string; createdAt: string }> {
  await ensureCollectionsInfrastructure();
  const found = await pool.query<GuardianIdentityRow>(
    `
      SELECT
        g.id AS guardian_id,
        CONCAT(g.first_name, ' ', g.last_name) AS guardian_name,
        NULLIF(TRIM(g.email), '') AS guardian_email,
        NULLIF(TRIM(g.phone_whatsapp), '') AS guardian_phone
      FROM guardians g
      WHERE g.id = $1
      LIMIT 1
    `,
    [guardianId]
  );

  if (!found.rows[0]) {
    throw new HttpError(404, 'Guardian not found');
  }

  const created = await pool.query<{ id: string; created_at: string }>(
    `
      INSERT INTO guardian_contact_notes (guardian_id, note, created_by)
      VALUES ($1, $2, $3)
      RETURNING id, created_at::text
    `,
    [guardianId, note, normalizeActor(actor)]
  );
  const row = created.rows[0];
  if (!row) {
    throw new HttpError(500, 'Failed to save contact note');
  }

  await logReminderHistory({
    guardianId,
    playerId: null,
    invoiceId: null,
    stage: 'none',
    channel: 'manual',
    status: 'manual_contact',
    messageSnapshot: note,
    actor: normalizeActor(actor),
    meta: { source: 'guardian_contact_notes' }
  });

  return {
    guardianId,
    noteId: row.id,
    createdAt: row.created_at
  };
}
