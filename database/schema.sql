-- Dynaverse Football Academy MIS schema
-- PostgreSQL 14+

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
CREATE TYPE preferred_foot_type AS ENUM ('left', 'right', 'both', 'unknown');
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled');
CREATE TYPE payment_method AS ENUM ('eft', 'cash', 'card', 'mobile_money', 'other');
CREATE TYPE reminder_trigger_type AS ENUM ('before_due', 'on_due', 'overdue');
CREATE TYPE reminder_channel_type AS ENUM ('email', 'whatsapp', 'sms');
CREATE TYPE attendance_status_type AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE consent_type AS ENUM ('academy_terms', 'media_permission', 'emergency_treatment', 'data_processing');

CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender gender_type NOT NULL DEFAULT 'prefer_not_to_say',
  id_or_birth_cert_no TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  town TEXT,
  region TEXT,
  school_name TEXT,
  school_grade TEXT,
  preferred_position TEXT,
  preferred_foot preferred_foot_type NOT NULL DEFAULT 'unknown',
  years_of_experience NUMERIC(4, 2),
  previous_club TEXT,
  joined_on DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone_whatsapp TEXT NOT NULL,
  alternate_phone TEXT,
  email TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  town TEXT,
  region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE player_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,
  relationship_to_player TEXT NOT NULL,
  is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
  is_billing_contact BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, guardian_id)
);

CREATE TABLE emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship_to_player TEXT NOT NULL,
  phone TEXT NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE medical_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  medical_conditions TEXT,
  allergies TEXT,
  has_asthma BOOLEAN NOT NULL DEFAULT FALSE,
  injury_history TEXT,
  current_medication TEXT,
  medical_aid_provider TEXT,
  medical_aid_number TEXT,
  doctor_or_clinic_name TEXT,
  doctor_phone TEXT,
  emergency_treatment_consent BOOLEAN NOT NULL DEFAULT FALSE,
  confidentiality_level TEXT NOT NULL DEFAULT 'restricted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE coaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE training_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- U9/U11/U13/U15
  display_name TEXT NOT NULL,
  training_day_of_week SMALLINT, -- 0-6, optional
  training_start_time TIME,
  training_end_time TIME,
  coach_id UUID REFERENCES coaches(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  training_group_id UUID REFERENCES training_groups(id) ON DELETE SET NULL,
  assigned_coach_id UUID REFERENCES coaches(id) ON DELETE SET NULL,
  started_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ended_on DATE,
  uniform_size TEXT,
  uniform_issued_on DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE fee_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE, -- REGISTRATION_ONCE, MONTHLY_SUBSCRIPTION
  name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  billing_frequency TEXT NOT NULL, -- once, monthly
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE player_fee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  amount_override NUMERIC(12, 2),
  due_day_of_month SMALLINT NOT NULL DEFAULT 5 CHECK (due_day_of_month BETWEEN 1 AND 28),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  billing_guardian_id UUID REFERENCES guardians(id) ON DELETE SET NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status invoice_status NOT NULL DEFAULT 'draft',
  subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  sent_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fee_plan_id UUID REFERENCES fee_plans(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_amount NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  received_on DATE NOT NULL DEFAULT CURRENT_DATE,
  method payment_method NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  payment_reference TEXT,
  external_reference TEXT,
  recorded_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_allocated NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(payment_id, invoice_id)
);

CREATE TABLE reminder_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  trigger_type reminder_trigger_type NOT NULL,
  offset_days INTEGER NOT NULL DEFAULT 0,
  channel reminder_channel_type NOT NULL DEFAULT 'email',
  template_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reminder_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reminder_rule_id UUID NOT NULL REFERENCES reminder_rules(id) ON DELETE RESTRICT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed, cancelled
  provider_message_id TEXT,
  error_message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reminder_history (
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
);

CREATE TABLE guardian_contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_group_id UUID NOT NULL REFERENCES training_groups(id) ON DELETE RESTRICT,
  coach_id UUID REFERENCES coaches(id) ON DELETE SET NULL,
  session_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(training_group_id, session_date, start_time)
);

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status attendance_status_type NOT NULL,
  arrival_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attendance_session_id, player_id)
);

CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE RESTRICT,
  consent_kind consent_type NOT NULL,
  granted BOOLEAN NOT NULL,
  signed_by_name TEXT NOT NULL,
  signed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  signature_blob TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE office_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'equipment',
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'units',
  stock_on_hand NUMERIC(12, 2) NOT NULL DEFAULT 0,
  minimum_stock_level NUMERIC(12, 2) NOT NULL DEFAULT 0,
  target_stock_level NUMERIC(12, 2) NOT NULL DEFAULT 0,
  reorder_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL, -- in, out, adjustment, donation
  quantity NUMERIC(12, 2) NOT NULL,
  unit_cost NUMERIC(12, 2),
  total_cost NUMERIC(12, 2),
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE funding_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'donor', -- donor, sponsor, internal, parent_contribution, other
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  committed_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  received_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE funding_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_source_id UUID NOT NULL REFERENCES funding_sources(id) ON DELETE CASCADE,
  received_amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  received_on DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  proof_url TEXT,
  notes TEXT,
  recorded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE club_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  need_code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL, -- equipment, kits, facilities, services, salaries, other
  need_name TEXT NOT NULL,
  description TEXT,
  quantity_needed NUMERIC(12, 2) NOT NULL DEFAULT 1,
  quantity_fulfilled NUMERIC(12, 2) NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'medium', -- critical, high, medium, low
  required_by DATE,
  estimated_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  justification TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open, approved, sourced, ordered, received, closed
  funding_status TEXT NOT NULL DEFAULT 'unfunded', -- unfunded, partially_funded, fully_funded
  funding_source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
  owner_name TEXT,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE procurement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  requested_by TEXT,
  approved_by TEXT,
  supplier_name TEXT,
  quote_reference TEXT,
  budget_line TEXT,
  funding_source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
  expected_delivery_date DATE,
  total_estimated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft', -- draft, submitted, approved, ordered, delivered, closed, cancelled
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE procurement_request_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_request_id UUID NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  need_id UUID NOT NULL REFERENCES club_needs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(procurement_request_id, need_id)
);

CREATE TABLE staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  rate_type TEXT NOT NULL, -- monthly, session, hourly
  rate_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'eft',
  contract_start DATE,
  contract_end DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE staff_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_member_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  period_month TEXT NOT NULL, -- YYYY-MM
  amount_due NUMERIC(12, 2) NOT NULL,
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  payment_date DATE,
  payment_reference TEXT,
  proof_url TEXT,
  funding_source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, part_paid, paid
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(staff_member_id, period_month)
);

CREATE TABLE financial_income_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL,
  source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  income_type TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  reference TEXT,
  proof_url TEXT,
  recorded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE financial_expense_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date DATE NOT NULL,
  source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'NAD',
  reference TEXT,
  proof_url TEXT,
  recorded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'system',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE system_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  section TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_players_player_code ON players(player_code);
CREATE INDEX idx_player_guardians_player ON player_guardians(player_id);
CREATE INDEX idx_player_guardians_guardian ON player_guardians(guardian_id);
CREATE INDEX idx_invoices_player_status ON invoices(player_id, status);
CREATE INDEX idx_invoices_due_date_status ON invoices(due_date, status);
CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);
CREATE INDEX idx_payments_player_id ON payments(player_id);
CREATE INDEX idx_payment_allocations_invoice_id ON payment_allocations(invoice_id);
CREATE INDEX idx_reminder_events_status_scheduled ON reminder_events(status, scheduled_for);
CREATE INDEX idx_reminder_history_guardian_sent_at ON reminder_history(guardian_id, sent_at DESC);
CREATE INDEX idx_guardian_contact_notes_guardian_created_at ON guardian_contact_notes(guardian_id, created_at DESC);
CREATE INDEX idx_attendance_records_player ON attendance_records(player_id);
CREATE INDEX idx_enrollments_player_status ON enrollments(player_id, status);
CREATE INDEX idx_system_audit_logs_created_at ON system_audit_logs(created_at DESC);
CREATE INDEX idx_inventory_items_stock ON inventory_items(stock_on_hand, minimum_stock_level);
CREATE INDEX idx_stock_movements_item_date ON stock_movements(inventory_item_id, movement_date DESC);
CREATE INDEX idx_funding_receipts_source_date ON funding_receipts(funding_source_id, received_on DESC);
CREATE INDEX idx_club_needs_status_priority ON club_needs(status, priority, required_by);
CREATE INDEX idx_procurement_requests_status ON procurement_requests(status, expected_delivery_date);
CREATE INDEX idx_staff_payments_period_status ON staff_payments(period_month, status);
CREATE INDEX idx_fin_income_date ON financial_income_entries(entry_date DESC);
CREATE INDEX idx_fin_income_source ON financial_income_entries(source_id, entry_date DESC);
CREATE INDEX idx_fin_expense_date ON financial_expense_entries(entry_date DESC);
CREATE INDEX idx_fin_expense_source ON financial_expense_entries(source_id, entry_date DESC);

-- Baseline fee plans from your registration form.
INSERT INTO fee_plans (code, name, amount, currency, billing_frequency)
VALUES
  ('REGISTRATION_ONCE', 'Registration Fee', 50.00, 'NAD', 'once'),
  ('MONTHLY_SUBSCRIPTION', 'Monthly Subscription', 250.00, 'NAD', 'monthly')
ON CONFLICT (code) DO NOTHING;

-- Baseline reminder rules.
INSERT INTO reminder_rules (name, trigger_type, offset_days, channel, template_key)
VALUES
  ('Invoice reminder 3 days before due', 'before_due', 3, 'email', 'invoice_before_due_3d'),
  ('Invoice reminder on due date', 'on_due', 0, 'email', 'invoice_due_today'),
  ('Invoice reminder 3 days overdue', 'overdue', 3, 'email', 'invoice_overdue_3d')
ON CONFLICT (name) DO NOTHING;

INSERT INTO funding_sources (source_code, name, source_type, committed_amount, received_amount, currency)
VALUES ('FUND-CORE', 'Core Academy Fund', 'internal', 0, 0, 'NAD')
ON CONFLICT (source_code) DO NOTHING;

INSERT INTO system_settings (key, value, updated_by)
VALUES
  (
    'academy_profile',
    jsonb_build_object(
      'academyName', 'Dynaverse Football Academy',
      'divisionLine', 'A Division of Dynaverse Investments',
      'tagline', 'Building Character - Developing Talent - Future Professionals',
      'contactEmail', 'services@dynaverseinvestment.com',
      'contactPhone', '+264 81 299 4529',
      'addressLine', 'Windhoek, Namibia',
      'currency', 'NAD',
      'timezone', 'Africa/Windhoek',
      'bankName', '[Bank Name]',
      'bankAccountName', 'Dynaverse Football Academy',
      'bankAccountNumber', '[XXXXXXX]'
    ),
    'system'
  ),
  (
    'billing_defaults',
    jsonb_build_object(
      'registrationFee', 50.00,
      'monthlyFee', 250.00,
      'dueDayOfMonth', 5,
      'invoiceGraceDays', 7,
      'defaultCurrency', 'NAD'
    ),
    'system'
  ),
  (
    'reminder_defaults',
    jsonb_build_object(
      'beforeDueDays', 3,
      'overdueDays', 3,
      'enableEmail', true,
      'enableWhatsApp', true
    ),
    'system'
  ),
  (
    'channels_config',
    jsonb_build_object(
      'smtpHost', '',
      'smtpPort', 587,
      'smtpSecure', false,
      'smtpUser', '',
      'smtpPass', '',
      'emailFrom', 'billing@dynaverse.local',
      'smtpSimulate', false,
      'whatsappApiUrl', '',
      'whatsappApiToken', '',
      'whatsappDefaultSender', '',
      'whatsappSimulate', false
    ),
    'system'
  )
ON CONFLICT (key) DO NOTHING;
