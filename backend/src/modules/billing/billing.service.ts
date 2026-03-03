import dayjs from 'dayjs';
import type { PoolClient } from 'pg';
import { env } from '../../config/env.js';
import { sendEmailMessage, sendWhatsAppMessage } from '../../integrations/messaging.js';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { HttpError } from '../../utils/httpError.js';
import { createInvoiceNumber } from '../../utils/ids.js';
import { buildInvoicePdf, buildReceiptPdf } from './billing.documents.js';
import { getAcademyProfileSettings } from '../settings/settings.store.js';
import type {
  CreateCustomFeeInvoiceInput,
  GenerateMonthlyInvoicesInput,
  RecordPaymentInput,
  SendInvoiceInput,
  SendOutstandingRemindersInput
} from './billing.types.js';
import { scheduleReminderEvents } from '../reminders/reminders.scheduler.js';

type InvoiceListRow = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total_amount: string;
  paid_amount: string;
  currency: string;
  player_code: string;
  player_name: string;
};

type InvoiceHeaderRow = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total_amount: string;
  paid_amount: string;
  currency: string;
  player_id: string;
  player_code: string;
  player_name: string;
  guardian_id: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
};

type InvoiceItemRow = {
  id: string;
  description: string;
  period_start: string | null;
  period_end: string | null;
  quantity: string;
  unit_amount: string;
  line_total: string;
};

type InvoicePaymentRow = {
  payment_id: string;
  received_on: string;
  method: string;
  allocated_amount: string;
  payment_reference: string | null;
  external_reference: string | null;
};

type OpenInvoiceRow = {
  id: string;
  total_amount: string;
  paid_amount: string;
  due_date: string;
};

type MonthlyAssignmentRow = {
  player_id: string;
  player_code: string;
  fee_plan_id: string;
  amount_to_bill: string;
  currency: string;
  due_day_of_month: number;
  guardian_id: string | null;
};

type PlayerBillingRow = {
  player_id: string;
  player_code: string;
  player_name: string;
  guardian_id: string | null;
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_phone: string | null;
};

type OutstandingMonthlyInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  due_date: string;
  status: string;
  total_amount: string;
  paid_amount: string;
  outstanding_amount: string;
  currency: string;
  player_code: string;
  player_name: string;
  guardian_email: string | null;
  guardian_phone: string | null;
};

type ReceiptHeaderRow = {
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

type ReceiptAllocationRow = {
  invoice_number: string;
  amount_allocated: string;
};

export async function listInvoices(status?: string, limit = 50): Promise<InvoiceListRow[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 200);
  let statusClause = '';
  const values: unknown[] = [normalizedLimit];

  if (status === 'open') {
    statusClause = `AND i.status IN ('sent', 'partially_paid', 'overdue')`;
  } else if (status) {
    values.push(status);
    statusClause = `AND i.status = $2`;
  }

  const result = await pool.query<InvoiceListRow>(
    `
      SELECT
        i.id AS invoice_id,
        i.invoice_number,
        i.status::text,
        i.issue_date::text,
        i.due_date::text,
        i.total_amount::text,
        COALESCE(SUM(pa.amount_allocated), 0)::text AS paid_amount,
        i.currency,
        p.player_code,
        CONCAT(p.first_name, ' ', p.last_name) AS player_name
      FROM invoices i
      INNER JOIN players p ON p.id = i.player_id
      LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
      WHERE 1=1
      ${statusClause}
      GROUP BY i.id, p.player_code, p.first_name, p.last_name
      ORDER BY i.due_date ASC
      LIMIT $1
    `,
    values
  );

  return result.rows;
}

export async function getInvoiceDetails(invoiceId: string): Promise<{
  invoice: {
    id: string;
    invoiceNumber: string;
    status: string;
    issueDate: string;
    dueDate: string;
    currency: string;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
  };
  player: {
    id: string;
    code: string;
    name: string;
  };
  guardian: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  items: Array<{
    id: string;
    description: string;
    periodStart: string | null;
    periodEnd: string | null;
    quantity: number;
    unitAmount: number;
    lineTotal: number;
  }>;
  payments: Array<{
    paymentId: string;
    receivedOn: string;
    method: string;
    allocatedAmount: number;
    paymentReference: string | null;
    externalReference: string | null;
  }>;
} | null> {
  const header = await loadInvoiceHeader(invoiceId);
  if (!header) {
    return null;
  }

  const itemsResult = await pool.query<InvoiceItemRow>(
    `
      SELECT
        id,
        description,
        period_start::text,
        period_end::text,
        quantity::text,
        unit_amount::text,
        line_total::text
      FROM invoice_items
      WHERE invoice_id = $1
      ORDER BY created_at ASC
    `,
    [invoiceId]
  );

  const paymentsResult = await pool.query<InvoicePaymentRow>(
    `
      SELECT
        p.id AS payment_id,
        p.received_on::text,
        p.method::text,
        pa.amount_allocated::text AS allocated_amount,
        p.payment_reference,
        p.external_reference
      FROM payment_allocations pa
      INNER JOIN payments p ON p.id = pa.payment_id
      WHERE pa.invoice_id = $1
      ORDER BY p.received_on DESC
    `,
    [invoiceId]
  );

  const totalAmount = Number(header.total_amount);
  const paidAmount = Number(header.paid_amount);

  return {
    invoice: {
      id: header.invoice_id,
      invoiceNumber: header.invoice_number,
      status: header.status,
      issueDate: header.issue_date,
      dueDate: header.due_date,
      currency: header.currency,
      totalAmount,
      paidAmount,
      outstandingAmount: Math.max(totalAmount - paidAmount, 0)
    },
    player: {
      id: header.player_id,
      code: header.player_code,
      name: header.player_name
    },
    guardian: {
      id: header.guardian_id,
      name: header.guardian_name,
      email: header.guardian_email,
      phone: header.guardian_phone
    },
    items: itemsResult.rows.map((item) => ({
      id: item.id,
      description: item.description,
      periodStart: item.period_start,
      periodEnd: item.period_end,
      quantity: Number(item.quantity),
      unitAmount: Number(item.unit_amount),
      lineTotal: Number(item.line_total)
    })),
    payments: paymentsResult.rows.map((payment) => ({
      paymentId: payment.payment_id,
      receivedOn: payment.received_on,
      method: payment.method,
      allocatedAmount: Number(payment.allocated_amount),
      paymentReference: payment.payment_reference,
      externalReference: payment.external_reference
    }))
  };
}

export async function createCustomFeeInvoice(input: CreateCustomFeeInvoiceInput): Promise<{
  invoiceId: string;
  invoiceNumber: string;
  playerCode: string;
}> {
  return withTransaction(async (client) => {
    const player = await loadPlayerBillingByCode(client, input.playerCode);
    if (!player) {
      throw new HttpError(404, `Player with code ${input.playerCode} not found`);
    }

    const issueDate = dayjs().format('YYYY-MM-DD');
    const invoiceNumber = createInvoiceNumber('ACT');
    const lineDescription = `[${input.category}] ${input.feeName}${input.description ? ` - ${input.description}` : ''}`;
    const quantity = input.quantity;
    const lineTotal = Number((input.amount * quantity).toFixed(2));

    const invoiceResult = await client.query<{ id: string }>(
      `
        INSERT INTO invoices (
          invoice_number,
          player_id,
          billing_guardian_id,
          issue_date,
          due_date,
          status,
          subtotal_amount,
          total_amount,
          currency,
          sent_at
        )
        VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6, $7, NOW())
        RETURNING id
      `,
      [invoiceNumber, player.player_id, player.guardian_id, issueDate, input.dueDate, lineTotal, env.DEFAULT_CURRENCY]
    );

    const invoiceId = invoiceResult.rows[0]?.id;
    if (!invoiceId) {
      throw new HttpError(500, 'Failed to create activity contribution invoice');
    }

    await client.query(
      `
        INSERT INTO invoice_items (
          invoice_id,
          description,
          quantity,
          unit_amount,
          line_total
        )
        VALUES ($1, $2, $3, $4, $5)
      `,
      [invoiceId, lineDescription, quantity, input.amount, lineTotal]
    );

    await scheduleReminderEvents(client, invoiceId, input.dueDate, {
      source: 'activity-contribution',
      category: input.category,
      feeName: input.feeName
    });

    return {
      invoiceId,
      invoiceNumber,
      playerCode: player.player_code
    };
  });
}

export async function getInvoicePdfBuffer(invoiceId: string): Promise<Buffer> {
  const details = await getInvoiceDetails(invoiceId);
  if (!details) {
    throw new HttpError(404, 'Invoice not found');
  }
  const academy = await getAcademyProfileSettings();

  const subtotalAmount = details.items.reduce((sum, item) => sum + item.lineTotal, 0);
  const guardianContact = [details.guardian.phone, details.guardian.email]
    .filter((value) => Boolean(value))
    .join(' / ');

  return buildInvoicePdf({
    academyName: academy.academyName,
    academyDivisionLine: academy.divisionLine,
    invoiceNumber: details.invoice.invoiceNumber,
    issueDate: details.invoice.issueDate,
    dueDate: details.invoice.dueDate,
    status: details.invoice.outstandingAmount > 0 ? 'UNPAID' : 'PAID',
    currency: details.invoice.currency,
    subtotalAmount,
    totalAmount: details.invoice.totalAmount,
    playerCode: details.player.code,
    playerName: details.player.name,
    guardianName: details.guardian.name,
    guardianContact: guardianContact.length > 0 ? guardianContact : null,
    items: details.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      lineTotal: item.lineTotal,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd
    })),
    paymentMethod: 'EFT / Cash',
    paymentReference: details.player.code,
    bankName: academy.bankName,
    bankAccountName: academy.bankAccountName,
    bankAccountNumber: academy.bankAccountNumber,
    issuedBy: `${academy.academyName} MIS`
  });
}

export async function sendInvoiceToGuardian(invoiceId: string, input: SendInvoiceInput): Promise<{
  invoiceId: string;
  invoiceNumber: string;
  channel: 'email' | 'whatsapp';
  recipient: string;
  simulated: boolean;
  providerMessageId?: string;
}> {
  const details = await getInvoiceDetails(invoiceId);
  if (!details) {
    throw new HttpError(404, 'Invoice not found');
  }

  const outstandingText = `${details.invoice.currency} ${details.invoice.outstandingAmount.toFixed(2)}`;
  const messageText =
    `Dynaverse Football Academy\n` +
    `Invoice ${details.invoice.invoiceNumber}\n` +
    `Player: ${details.player.name} (${details.player.code})\n` +
    `Due Date: ${details.invoice.dueDate}\n` +
    `Outstanding: ${outstandingText}\n` +
    `${input.note ? `Note: ${input.note}\n` : ''}` +
    `Download: ${env.NODE_ENV === 'production' ? '/billing portal' : `http://localhost:${env.PORT}/api/billing/invoices/${details.invoice.id}/pdf`}`;

  if (input.channel === 'email') {
    const recipient = input.email ?? details.guardian.email;
    if (!recipient) {
      throw new HttpError(400, 'No guardian email found for this invoice');
    }

    const pdf = await getInvoicePdfBuffer(invoiceId);
    const delivery = await sendEmailMessage({
      to: recipient,
      subject: `Invoice ${details.invoice.invoiceNumber} - Dynaverse Football Academy`,
      text: messageText,
      attachments: [
        {
          filename: `${details.invoice.invoiceNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf'
        }
      ]
    });

    if (!delivery.success) {
      throw new HttpError(502, delivery.error ?? 'Failed to send invoice email');
    }

    await pool.query(`UPDATE invoices SET sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [invoiceId]);
    return {
      invoiceId,
      invoiceNumber: details.invoice.invoiceNumber,
      channel: 'email',
      recipient,
      simulated: delivery.simulated,
      providerMessageId: delivery.providerMessageId
    };
  }

  const recipient = input.phone ?? details.guardian.phone;
  if (!recipient) {
    throw new HttpError(400, 'No guardian WhatsApp phone found for this invoice');
  }

  const delivery = await sendWhatsAppMessage({
    to: recipient,
    message: messageText
  });
  if (!delivery.success) {
    throw new HttpError(502, delivery.error ?? 'Failed to send invoice via WhatsApp');
  }

  await pool.query(`UPDATE invoices SET sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [invoiceId]);
  return {
    invoiceId,
    invoiceNumber: details.invoice.invoiceNumber,
    channel: 'whatsapp',
    recipient,
    simulated: delivery.simulated,
    providerMessageId: delivery.providerMessageId
  };
}

export async function listOutstandingMonthlyFees(limit = 200): Promise<OutstandingMonthlyInvoiceRow[]> {
  const result = await pool.query<OutstandingMonthlyInvoiceRow>(
    `
      SELECT
        i.id AS invoice_id,
        i.invoice_number,
        i.due_date::text,
        i.status::text,
        i.total_amount::text,
        COALESCE(SUM(pa.amount_allocated), 0)::text AS paid_amount,
        (i.total_amount - COALESCE(SUM(pa.amount_allocated), 0))::text AS outstanding_amount,
        i.currency,
        p.player_code,
        CONCAT(p.first_name, ' ', p.last_name) AS player_name,
        COALESCE(bg.email, pg.email) AS guardian_email,
        COALESCE(bg.phone_whatsapp, pg.phone_whatsapp) AS guardian_phone
      FROM invoices i
      INNER JOIN players p ON p.id = i.player_id
      INNER JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN fee_plans fp ON fp.id = ii.fee_plan_id
      LEFT JOIN guardians bg ON bg.id = i.billing_guardian_id
      LEFT JOIN LATERAL (
        SELECT g.email, g.phone_whatsapp
        FROM player_guardians x
        INNER JOIN guardians g ON g.id = x.guardian_id
        WHERE x.player_id = p.id AND x.is_primary_contact = TRUE
        LIMIT 1
      ) pg ON TRUE
      LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
      WHERE
        fp.code = 'MONTHLY_SUBSCRIPTION'
        AND i.status IN ('sent', 'partially_paid', 'overdue')
        AND i.due_date <= CURRENT_DATE
      GROUP BY i.id, p.player_code, p.first_name, p.last_name, bg.email, bg.phone_whatsapp, pg.email, pg.phone_whatsapp
      HAVING (i.total_amount - COALESCE(SUM(pa.amount_allocated), 0)) > 0
      ORDER BY i.due_date ASC
      LIMIT $1
    `,
    [Math.min(Math.max(limit, 1), 500)]
  );
  return result.rows;
}

export async function sendOutstandingMonthlyFeeReminders(
  input: SendOutstandingRemindersInput
): Promise<{
  totalTargets: number;
  sentEmail: number;
  sentWhatsApp: number;
  failed: number;
  simulated: number;
}> {
  const targets = await listOutstandingMonthlyFees(input.limit);
  let sentEmail = 0;
  let sentWhatsApp = 0;
  let failed = 0;
  let simulated = 0;

  for (const target of targets) {
    const message =
      `Dynaverse Football Academy fee reminder\n` +
      `Player: ${target.player_name} (${target.player_code})\n` +
      `Invoice: ${target.invoice_number}\n` +
      `Due Date: ${target.due_date}\n` +
      `Outstanding: ${target.currency} ${Number(target.outstanding_amount).toFixed(2)}`;

    if (input.channel === 'email' || input.channel === 'both') {
      if (!target.guardian_email) {
        failed += 1;
      } else {
        const emailDelivery = await sendEmailMessage({
          to: target.guardian_email,
          subject: `Outstanding Monthly Fee - ${target.invoice_number}`,
          text: message
        });
        if (emailDelivery.success) {
          sentEmail += 1;
          if (emailDelivery.simulated) {
            simulated += 1;
          }
        } else {
          failed += 1;
        }
      }
    }

    if (input.channel === 'whatsapp' || input.channel === 'both') {
      if (!target.guardian_phone) {
        failed += 1;
      } else {
        const waDelivery = await sendWhatsAppMessage({
          to: target.guardian_phone,
          message
        });
        if (waDelivery.success) {
          sentWhatsApp += 1;
          if (waDelivery.simulated) {
            simulated += 1;
          }
        } else {
          failed += 1;
        }
      }
    }
  }

  return {
    totalTargets: targets.length,
    sentEmail,
    sentWhatsApp,
    failed,
    simulated
  };
}

export async function getReceiptPdfBuffer(paymentId: string): Promise<Buffer> {
  const headerResult = await pool.query<ReceiptHeaderRow>(
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
      WHERE p.id = $1
      LIMIT 1
    `,
    [paymentId]
  );

  const header = headerResult.rows[0];
  if (!header) {
    throw new HttpError(404, 'Payment not found');
  }

  const allocationsResult = await pool.query<ReceiptAllocationRow>(
    `
      SELECT
        i.invoice_number,
        pa.amount_allocated::text
      FROM payment_allocations pa
      INNER JOIN invoices i ON i.id = pa.invoice_id
      WHERE pa.payment_id = $1
      ORDER BY i.issue_date ASC
    `,
    [paymentId]
  );

  const appliedDescriptionsResult = await pool.query<{ description: string }>(
    `
      SELECT DISTINCT ii.description
      FROM payment_allocations pa
      INNER JOIN invoice_items ii ON ii.invoice_id = pa.invoice_id
      WHERE pa.payment_id = $1
      ORDER BY ii.description ASC
      LIMIT 8
    `,
    [paymentId]
  );

  const balanceDueResult = await pool.query<{ balance_due: string }>(
    `
      WITH touched AS (
        SELECT DISTINCT invoice_id
        FROM payment_allocations
        WHERE payment_id = $1
      ),
      invoice_paid AS (
        SELECT invoice_id, SUM(amount_allocated) AS paid_sum
        FROM payment_allocations
        GROUP BY invoice_id
      )
      SELECT COALESCE(SUM(GREATEST(i.total_amount - COALESCE(ip.paid_sum, 0), 0)), 0)::text AS balance_due
      FROM touched t
      INNER JOIN invoices i ON i.id = t.invoice_id
      LEFT JOIN invoice_paid ip ON ip.invoice_id = i.id
    `,
    [paymentId]
  );

  const balanceDue = Number(balanceDueResult.rows[0]?.balance_due ?? 0);
  const paymentAmount = Number(header.amount);
  const academy = await getAcademyProfileSettings();

  return buildReceiptPdf({
    academyName: academy.academyName,
    academyTagline: academy.tagline,
    receiptNumber: `RCT-${header.payment_id.slice(0, 8).toUpperCase()}`,
    receiptDate: dayjs(header.received_on).format('YYYY-MM-DD'),
    status: balanceDue <= 0 ? 'PAID' : 'PARTIAL',
    academyProgram: academy.academyName,
    currency: header.currency,
    paymentAmount,
    paymentMethod: header.method,
    paymentReference: header.payment_reference,
    playerCode: header.player_code,
    playerName: header.player_name,
    appliedTo:
      appliedDescriptionsResult.rows.length > 0
        ? appliedDescriptionsResult.rows.map((row) => row.description)
        : ['Invoice(s) Settled Successfully'],
    totalPaid: paymentAmount,
    balanceDue,
    issuedBy: `${academy.academyName} MIS`,
    generatedOn: dayjs().format('YYYY-MM-DD'),
    contactEmail: academy.contactEmail,
    contactPhone: academy.contactPhone
  });
}

export async function recordPayment(input: RecordPaymentInput): Promise<{
  paymentId: string;
  playerId: string;
  allocatedAmount: number;
  unallocatedAmount: number;
  allocations: Array<{ invoiceId: string; amount: number }>;
}> {
  return withTransaction(async (client) => {
    const playerResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM players
        WHERE player_code = $1
        LIMIT 1
      `,
      [input.playerCode]
    );
    const playerId = playerResult.rows[0]?.id;
    if (!playerId) {
      throw new HttpError(404, `Player with code ${input.playerCode} not found`);
    }

    const paymentResult = await client.query<{ id: string }>(
      `
        INSERT INTO payments (
          player_id,
          received_on,
          method,
          amount,
          payment_reference,
          external_reference,
          notes,
          recorded_by
        )
        VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::payment_method, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        playerId,
        input.receivedOn ?? null,
        input.method,
        input.amount,
        input.paymentReference ?? null,
        input.externalReference ?? null,
        input.notes ?? null,
        input.recordedBy ?? null
      ]
    );

    const paymentId = paymentResult.rows[0]?.id;
    if (!paymentId) {
      throw new HttpError(500, 'Failed to record payment');
    }

    const openInvoices = await client.query<OpenInvoiceRow>(
      `
        SELECT
          i.id,
          i.total_amount::text,
          COALESCE(SUM(pa.amount_allocated), 0)::text AS paid_amount,
          i.due_date::text
        FROM invoices i
        LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
        WHERE
          i.player_id = $1
          AND i.status IN ('sent', 'partially_paid', 'overdue')
        GROUP BY i.id
        ORDER BY i.due_date ASC
      `,
      [playerId]
    );

    let remaining = input.amount;
    const allocations: Array<{ invoiceId: string; amount: number }> = [];

    for (const invoice of openInvoices.rows) {
      if (remaining <= 0) {
        break;
      }

      const total = Number(invoice.total_amount);
      const paid = Number(invoice.paid_amount);
      const outstanding = Math.max(total - paid, 0);
      if (outstanding <= 0) {
        continue;
      }

      const amountToAllocate = Math.min(remaining, outstanding);
      await client.query(
        `
          INSERT INTO payment_allocations (
            payment_id,
            invoice_id,
            amount_allocated
          )
          VALUES ($1, $2, $3)
        `,
        [paymentId, invoice.id, amountToAllocate]
      );
      await refreshInvoiceStatus(client, invoice.id);

      allocations.push({ invoiceId: invoice.id, amount: amountToAllocate });
      remaining -= amountToAllocate;
    }

    return {
      paymentId,
      playerId,
      allocatedAmount: input.amount - remaining,
      unallocatedAmount: remaining,
      allocations
    };
  });
}

export async function generateMonthlyInvoices(
  input: GenerateMonthlyInvoicesInput
): Promise<{ created: number; skipped: number; billingMonth: string }> {
  const month = input.billingMonth ?? dayjs().format('YYYY-MM');
  const monthStart = dayjs(`${month}-01`);
  if (!monthStart.isValid()) {
    throw new HttpError(400, 'Invalid billing month');
  }

  const periodStart = monthStart.format('YYYY-MM-DD');
  const periodEnd = monthStart.endOf('month').format('YYYY-MM-DD');
  const monthTag = monthStart.format('YYYYMM');
  const today = dayjs();

  return withTransaction(async (client) => {
    const assignments = await client.query<MonthlyAssignmentRow>(
      `
        SELECT
          p.id AS player_id,
          p.player_code,
          a.fee_plan_id,
          COALESCE(a.amount_override, fp.amount)::text AS amount_to_bill,
          fp.currency,
          a.due_day_of_month,
          pg.guardian_id
        FROM players p
        INNER JOIN player_fee_assignments a
          ON a.player_id = p.id
          AND a.is_active = TRUE
        INNER JOIN fee_plans fp
          ON fp.id = a.fee_plan_id
          AND fp.code = 'MONTHLY_SUBSCRIPTION'
          AND fp.is_active = TRUE
        LEFT JOIN player_guardians pg
          ON pg.player_id = p.id
          AND pg.is_billing_contact = TRUE
        WHERE
          p.status = 'active'
          AND a.effective_from <= $1::date
          AND (a.effective_to IS NULL OR a.effective_to >= $1::date)
      `,
      [periodStart]
    );

    let created = 0;
    let skipped = 0;

    for (const assignment of assignments.rows) {
      const exists = await client.query<{ id: string }>(
        `
          SELECT i.id
          FROM invoices i
          INNER JOIN invoice_items ii ON ii.invoice_id = i.id
          WHERE
            i.player_id = $1
            AND ii.fee_plan_id = $2
            AND ii.period_start = $3::date
          LIMIT 1
        `,
        [assignment.player_id, assignment.fee_plan_id, periodStart]
      );
      if (exists.rows.length > 0) {
        skipped += 1;
        continue;
      }

      const dueDateRaw = monthStart.date(assignment.due_day_of_month);
      const issueDate = today.format('YYYY-MM-DD');
      const dueDate = dueDateRaw.isBefore(today, 'day') ? issueDate : dueDateRaw.format('YYYY-MM-DD');
      const amount = Number(assignment.amount_to_bill);
      const invoiceNumber = `MON-${monthTag}-${assignment.player_code}`;

      const invoiceResult = await client.query<{ id: string }>(
        `
          INSERT INTO invoices (
            invoice_number,
            player_id,
            billing_guardian_id,
            issue_date,
            due_date,
            status,
            subtotal_amount,
            total_amount,
            currency,
            sent_at
          )
          VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6, $7, NOW())
          RETURNING id
        `,
        [
          invoiceNumber,
          assignment.player_id,
          assignment.guardian_id,
          issueDate,
          dueDate,
          amount,
          assignment.currency
        ]
      );

      const invoiceId = invoiceResult.rows[0]?.id;
      if (!invoiceId) {
        throw new HttpError(500, 'Failed to create monthly invoice');
      }

      await client.query(
        `
          INSERT INTO invoice_items (
            invoice_id,
            fee_plan_id,
            description,
            period_start,
            period_end,
            quantity,
            unit_amount,
            line_total
          )
          VALUES ($1, $2, $3, $4::date, $5::date, 1, $6, $6)
        `,
        [
          invoiceId,
          assignment.fee_plan_id,
          `Monthly subscription ${monthStart.format('MMMM YYYY')}`,
          periodStart,
          periodEnd,
          amount
        ]
      );

      await scheduleReminderEvents(client, invoiceId, dueDate, { source: 'monthly-billing', month });
      created += 1;
    }

    return {
      created,
      skipped,
      billingMonth: month
    };
  });
}

export async function markOverdueInvoices(): Promise<number> {
  const result = await pool.query(
    `
      UPDATE invoices
      SET status = 'overdue',
          updated_at = NOW()
      WHERE
        status IN ('sent', 'partially_paid')
        AND due_date < CURRENT_DATE
    `
  );
  return result.rowCount ?? 0;
}

async function refreshInvoiceStatus(client: PoolClient, invoiceId: string): Promise<void> {
  const result = await client.query<{ total_amount: string; paid_amount: string; due_date: string }>(
    `
      SELECT
        i.total_amount::text,
        COALESCE(SUM(pa.amount_allocated), 0)::text AS paid_amount,
        i.due_date::text
      FROM invoices i
      LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
      WHERE i.id = $1
      GROUP BY i.id
    `,
    [invoiceId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, 'Invoice not found during status refresh');
  }

  const total = Number(row.total_amount);
  const paid = Number(row.paid_amount);
  const dueDate = dayjs(row.due_date);
  const isOverdue = dueDate.isBefore(dayjs(), 'day');

  let nextStatus: 'sent' | 'partially_paid' | 'paid' | 'overdue' = 'sent';
  if (paid >= total) {
    nextStatus = 'paid';
  } else if (paid > 0) {
    nextStatus = isOverdue ? 'overdue' : 'partially_paid';
  } else if (isOverdue) {
    nextStatus = 'overdue';
  }

  await client.query(
    `
      UPDATE invoices
      SET status = $2::invoice_status,
          updated_at = NOW()
      WHERE id = $1
    `,
    [invoiceId, nextStatus]
  );
}

async function loadInvoiceHeader(invoiceId: string): Promise<InvoiceHeaderRow | null> {
  const result = await pool.query<InvoiceHeaderRow>(
    `
      SELECT
        i.id AS invoice_id,
        i.invoice_number,
        i.status::text,
        i.issue_date::text,
        i.due_date::text,
        i.total_amount::text,
        COALESCE(SUM(pa.amount_allocated), 0)::text AS paid_amount,
        i.currency,
        p.id AS player_id,
        p.player_code,
        CONCAT(p.first_name, ' ', p.last_name) AS player_name,
        COALESCE(bg.id, pg.id) AS guardian_id,
        COALESCE(CONCAT(bg.first_name, ' ', bg.last_name), CONCAT(pg.first_name, ' ', pg.last_name)) AS guardian_name,
        COALESCE(bg.email, pg.email) AS guardian_email,
        COALESCE(bg.phone_whatsapp, pg.phone_whatsapp) AS guardian_phone
      FROM invoices i
      INNER JOIN players p ON p.id = i.player_id
      LEFT JOIN guardians bg ON bg.id = i.billing_guardian_id
      LEFT JOIN LATERAL (
        SELECT g.id, g.first_name, g.last_name, g.email, g.phone_whatsapp
        FROM player_guardians x
        INNER JOIN guardians g ON g.id = x.guardian_id
        WHERE x.player_id = p.id
        ORDER BY x.is_billing_contact DESC, x.is_primary_contact DESC, x.created_at ASC
        LIMIT 1
      ) pg ON TRUE
      LEFT JOIN payment_allocations pa ON pa.invoice_id = i.id
      WHERE i.id = $1
      GROUP BY i.id, p.id, p.player_code, p.first_name, p.last_name, bg.id, bg.first_name, bg.last_name, bg.email, bg.phone_whatsapp, pg.id, pg.first_name, pg.last_name, pg.email, pg.phone_whatsapp
      LIMIT 1
    `,
    [invoiceId]
  );
  return result.rows[0] ?? null;
}

async function loadPlayerBillingByCode(
  client: PoolClient,
  playerCode: string
): Promise<PlayerBillingRow | null> {
  const result = await client.query<PlayerBillingRow>(
    `
      SELECT
        p.id AS player_id,
        p.player_code,
        CONCAT(p.first_name, ' ', p.last_name) AS player_name,
        x.guardian_id,
        CONCAT(g.first_name, ' ', g.last_name) AS guardian_name,
        g.email AS guardian_email,
        g.phone_whatsapp AS guardian_phone
      FROM players p
      LEFT JOIN LATERAL (
        SELECT guardian_id
        FROM player_guardians
        WHERE player_id = p.id
        ORDER BY is_billing_contact DESC, is_primary_contact DESC, created_at ASC
        LIMIT 1
      ) x ON TRUE
      LEFT JOIN guardians g ON g.id = x.guardian_id
      WHERE p.player_code = $1
      LIMIT 1
    `,
    [playerCode]
  );
  return result.rows[0] ?? null;
}
