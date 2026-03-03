# Dynaverse Football Academy MIS

End-to-end project scaffold for:

- Player registration and guardian records
- Medical + consent records
- Billing (registration + monthly fees)
- Invoices, payments, and reminders
- Attendance and group assignment

This system is for a football academy, not a general school MIS.

## Project Structure

- `backend/` API, jobs, and core business logic
- `frontend/` lightweight admin interface
- `database/` SQL schema, seeds, and migration folder
- `docs/` system blueprint and operating docs
- `scripts/` local bootstrap and operational scripts

## Quick Start

1. Start PostgreSQL:
   - `docker compose up -d`
2. Install dependencies:
   - `npm install`
3. Initialize DB:
   - `powershell -ExecutionPolicy Bypass -File scripts/init-db.ps1`
4. Copy backend env:
   - `Copy-Item backend/.env.example backend/.env`
5. Optional frontend env:
   - `Copy-Item frontend/.env.example frontend/.env`
6. Run apps:
   - `npm run dev`

Backend default URL: `http://localhost:5001`
Frontend default URL: `http://localhost:5173`

Current local setup in this repo uses backend port `5003` to avoid conflicts.

## API Modules

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/registrations`
- `GET /api/players`
- `GET /api/players/:playerId`
- `GET /api/catalog/training-groups`
- `GET /api/billing/invoices`
- `GET /api/billing/invoices/:invoiceId`
- `GET /api/billing/invoices/:invoiceId/pdf`
- `POST /api/billing/invoices/:invoiceId/send`
- `POST /api/billing/payments`
- `GET /api/billing/payments/:paymentId/receipt.pdf`
- `POST /api/billing/fees/custom-invoice`
- `GET /api/billing/fees/outstanding-monthly`
- `POST /api/billing/fees/outstanding-monthly/remind`
- `POST /api/billing/jobs/monthly-invoices`
- `POST /api/billing/jobs/outstanding-reminders`
- `GET /api/reminders/pending`
- `POST /api/reminders/dispatch-due`
- `GET /api/attendance/sessions`
- `POST /api/attendance/sessions`
- `POST /api/attendance/sessions/:sessionId/records`
- `GET /api/health`
- `GET /api/health/db`

## Notes

- Billing defaults are seeded to `N$50` registration and `N$250` monthly.
- Additional one-off/custom fee invoices are supported for activity contributions.
- Reminder rules are seeded for before-due, due-day, and overdue messages.
- Invoices can be viewed, downloaded as PDF, and sent by email or WhatsApp.
- Receipt PDFs are generated from recorded payments and allocations.
- Invoice/receipt branding and payment instruction fields can be customized in `backend/.env`:
  - `ACADEMY_CONTACT_EMAIL`, `ACADEMY_CONTACT_PHONE`
  - `BANK_NAME`, `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER`
- Email/WhatsApp sending works in two modes:
  - Real delivery if SMTP/WhatsApp API environment variables are configured.
  - Simulated delivery (safe default for local/dev) when provider credentials are missing.
- During registration, training group is auto-assigned from player age derived from date of birth.
- Default admin login for local development:
  - Username: `admin`
  - Password: `admin123`
