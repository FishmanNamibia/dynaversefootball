# Operations Playbook (Dynaverse Academy MIS)

## Monthly Billing Run

Run on day `1` of each month.

1. Select active players with active monthly fee assignments.
2. Generate one invoice per player for the billing month.
3. Add monthly fee item (`N$250` unless overridden).
4. Set due date using `due_day_of_month` from assignment.
5. Send invoice email to billing guardian.
6. Create reminder events from active rules.

## Registration Fee Run

Trigger after a new registration is approved.

1. Create registration invoice item (`N$50` once-off).
2. Send invoice to billing guardian.
3. Schedule reminders from active rules.

## Payment Reconciliation

Recommended EFT payment reference:

- `player_code` (primary)
- `invoice_number` (secondary)

Process:

1. Import/record payment entries.
2. Match by reference and amount.
3. Allocate payment to oldest open invoices first.
4. Update invoice status:
   - `paid` if total allocated >= total_amount
   - `partially_paid` otherwise
5. Mark overdue invoices as paid if balance becomes zero.

## Reminder Scheduler

Run every hour.

1. Fetch `reminder_events` where:
   - `status = 'pending'`
   - `scheduled_for <= now()`
2. Render template with player + invoice variables.
3. Send through channel provider (email first).
4. Update:
   - `status = 'sent'` and `sent_at` on success
   - `status = 'failed'` and `error_message` on failure

## Attendance Operations

1. Create one session per group training date.
2. Pre-populate attendance records from active enrollments.
3. Mark present/absent/late/excused.
4. Export monthly attendance by player and group.

## Recommended Service Jobs

- `job_generate_monthly_invoices` (monthly)
- `job_schedule_invoice_reminders` (after invoice creation)
- `job_send_due_reminders` (hourly)
- `job_mark_overdue_invoices` (daily)
- `job_reconcile_payments` (as bank data arrives)

## KPIs to Track Weekly

- Number of active players
- Invoice value billed this month
- Collection percentage this month
- Overdue amount and overdue count
- Attendance percentage by group

