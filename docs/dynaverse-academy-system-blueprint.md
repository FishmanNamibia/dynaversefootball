# Dynaverse Academy System Blueprint

## Objective
Build one system to manage:

- Player registration
- Parent/guardian records
- Emergency + medical safety data
- Fees (registration + monthly)
- Invoices, receipts, and reminders
- Attendance, groups, and coach assignment
- Consent + office-use notes

This blueprint follows your form structure (Sections A-G) and supports:

- Registration fee: `N$50` (once-off)
- Monthly fee: `N$250` (recurring)

## Recommended Delivery Path
Use a phased approach to keep momentum and reduce risk.

### Phase 1 (Fast, this week)
- Collect registrations using an online form that mirrors the PDF.
- Store data in structured tables.
- Generate invoices and reminders by email from Microsoft 365.
- Track EFT references with `player_code`.

### Phase 2 (Next)
- Add automated monthly invoicing.
- Add automated reminder schedule (before due, due day, overdue).
- Add attendance and roster dashboards.

### Phase 3 (Scale)
- Multi-club support.
- WhatsApp Business API integration.
- Parent portal and coach portal.

## Functional Modules

### 1) Player Registry
Stores Section A player profile:

- Full name, DOB, age, gender
- ID/Birth certificate number
- Address, region/town
- School and grade
- Position, preferred foot, experience, previous club
- System-generated `player_code`

### 2) Parent/Guardian CRM
Stores Section B:

- Guardian full name
- Relationship to player
- Phone/WhatsApp, email
- Alternate contact and address
- Primary billing contact flag

### 3) Emergency Contacts
Stores Section C:

- Contact name
- Relationship
- Phone
- Priority order

### 4) Medical & Safety (Confidential)
Stores Section D:

- Conditions, allergies, asthma, injuries
- Medication
- Medical aid/provider details
- Doctor/clinic + contact
- Emergency treatment consent

### 5) Training, Groups & Coaches
Stores Section E + office operation fields:

- Group assignment (`U9`, `U11`, `U13`, `U15`)
- Coach assignment
- Uniform size and issue date
- Start date and participation status

### 6) Billing & Invoicing
Stores Section E/F monetary flow:

- Fee plans (`REGISTRATION_ONCE`, `MONTHLY_SUBSCRIPTION`)
- Invoice generation
- Invoice items per billing period
- Receipt state from payment allocation

### 7) Reminders
Automated reminder rules:

- `before_due` (for example, 3 days before)
- `on_due`
- `overdue` (for example, 3 and 10 days after)

Channels:

- Email now (Microsoft 365 SMTP/Graph)
- WhatsApp/SMS later

### 8) Attendance
Session and attendance capture:

- Session date by group
- Present/Absent/Late/Excused
- Coach notes

### 9) Consent & Office Use
Stores Section F/G:

- Parent/guardian consent flags
- Media permission
- Signed by + signed date
- Internal office-use notes

## Core Workflows

### Workflow A: Registration Intake
1. Parent submits online form.
2. System creates player record.
3. Guardian and emergency contacts are linked.
4. Medical profile and consents are stored.
5. Enrollment/group is assigned.
6. Registration invoice is generated (`N$50`).

### Workflow B: Monthly Billing
1. Scheduler runs monthly.
2. Active players get monthly invoices (`N$250`) based on effective fee assignments.
3. Invoices are sent to billing contact.
4. Reminder events are pre-scheduled from rule offsets.

### Workflow C: Payment Reconciliation
1. Payment received (EFT/Cash/other).
2. Match using reference (`player_code` or invoice number).
3. Allocate payment to invoice(s).
4. Mark invoice paid/partially paid.
5. Issue receipt record.

### Workflow D: Reminders
1. Reminder worker checks due events.
2. Sends email (later WhatsApp/SMS).
3. Logs status and provider response.
4. Retries failed sends.

## Data Governance
- Restrict medical data access by role.
- Keep audit fields (`created_at`, `updated_at`) on all transactional tables.
- Use soft status (`active`, `inactive`) where historical records must persist.
- Never delete billing transactions; reverse with credit/adjustment entries.

## Metrics Dashboard (Minimum)
- Total active players by group
- Monthly billed amount
- Collection rate
- Overdue invoice count and value
- Attendance rate by group/player
- Medical flags count (for safety prep)

## Suggested Tech Stack (Pragmatic)
- Backend: Node.js + TypeScript + PostgreSQL
- Scheduler: cron/queue worker (BullMQ or equivalent)
- Email: Microsoft 365 SMTP/Graph
- WhatsApp later: WhatsApp Business API provider
- Frontend/Admin: existing stack or lightweight web admin

## Immediate Build Order
1. Create database schema (`database/schema.sql`).
2. Build registration API + validation.
3. Build monthly invoice generator job.
4. Build payment capture + reconciliation endpoint.
5. Build reminder scheduler and sender.
6. Add attendance endpoints and reports.

