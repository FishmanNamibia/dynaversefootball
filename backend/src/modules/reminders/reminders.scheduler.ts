import type { PoolClient } from 'pg';
import dayjs from 'dayjs';

type ReminderRuleRow = {
  id: string;
  trigger_type: 'before_due' | 'on_due' | 'overdue';
  offset_days: number;
};

function computeScheduledAt(dueDate: string, rule: ReminderRuleRow): Date {
  const base = dayjs(dueDate).hour(8).minute(0).second(0).millisecond(0);

  if (rule.trigger_type === 'before_due') {
    return base.subtract(rule.offset_days, 'day').toDate();
  }
  if (rule.trigger_type === 'overdue') {
    return base.add(rule.offset_days, 'day').toDate();
  }
  return base.toDate();
}

export async function scheduleReminderEvents(
  client: PoolClient,
  invoiceId: string,
  dueDate: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  const rules = await client.query<ReminderRuleRow>(
    `
      SELECT id, trigger_type, offset_days
      FROM reminder_rules
      WHERE is_active = TRUE
    `
  );

  for (const rule of rules.rows) {
    const scheduledFor = computeScheduledAt(dueDate, rule);
    await client.query(
      `
        INSERT INTO reminder_events (
          invoice_id,
          reminder_rule_id,
          scheduled_for,
          status,
          payload
        )
        VALUES ($1, $2, $3, 'pending', $4::jsonb)
      `,
      [invoiceId, rule.id, scheduledFor, JSON.stringify(context)]
    );
  }
}

