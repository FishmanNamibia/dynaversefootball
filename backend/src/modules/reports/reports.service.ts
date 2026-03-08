import dayjs from 'dayjs';
import { pool } from '../../db/pool.js';
import { HttpError } from '../../utils/httpError.js';
import { ensureOperationsInfrastructure } from '../operations/operations.service.js';
import { getAcademyProfileSettings } from '../settings/settings.store.js';
import { buildFinancialTransparencyPdfDocument } from './reports.documents.js';
import type {
  CreateManualExpenseEntryInput,
  CreateManualIncomeEntryInput,
  FinanceTransparencyQueryInput
} from './reports.types.js';

type PeriodBounds = { from: string; to: string; days: number };

type IncomeType = 'fees' | 'donation' | 'sponsor' | 'other';
type ExpenseCategory = 'coaching_salaries' | 'equipment' | 'facility' | 'transport' | 'administration' | 'other';

type IncomeEntry = {
  date: string;
  sourceType: IncomeType;
  source: string;
  description: string;
  amount: number;
  currency: string;
  reference: string | null;
  proofUrl: string | null;
  proof: string;
  status: 'verified' | 'missing';
  recordedBy: string | null;
};

type ExpenseEntry = {
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  reference: string | null;
  proofUrl: string | null;
  proof: string;
  status: 'verified' | 'missing';
  sourceCode: string | null;
  sourceName: string | null;
  actor: string | null;
};

export type FinancialTransparencyReport = {
  period: PeriodBounds;
  overview: {
    openingBalance: number;
    playerFeesCollected: number;
    donationsReceived: number;
    otherIncome: number;
    totalIncome: number;
    coachingSalaries: number;
    trainingEquipment: number;
    administration: number;
    facilitiesAndTransport: number;
    otherExpenditure: number;
    totalExpenditure: number;
    totalFundsAvailable: number;
    closingBalance: number;
    deficitAmount: number;
    surplusAmount: number;
    explanation: string;
  };
  summary: {
    openingBalance: number;
    fundingReceived: number;
    playerFeeCollections: number;
    totalInflows: number;
    payrollPaid: number;
    procurementSpend: number;
    inventoryUsageSpend: number;
    totalOutflows: number;
    netMovement: number;
    closingBalance: number;
  };
  incomeBreakdown: IncomeEntry[];
  expenditureBreakdown: {
    coachingAndStaff: { total: number; rows: ExpenseEntry[] };
    trainingEquipment: { total: number; rows: ExpenseEntry[] };
    administration: { total: number; rows: ExpenseEntry[] };
    facilitiesAndTransport: { total: number; rows: ExpenseEntry[] };
    other: { total: number; rows: ExpenseEntry[] };
    totalExpenditure: number;
  };
  budgetAllocation: Array<{ category: string; amount: number; percentage: number }>;
  accountability: Array<{
    date: string;
    category: string;
    transaction: string;
    amount: number;
    currency: string;
    proof: string;
    status: 'verified' | 'missing';
  }>;
  proof: {
    fundingReceiptsCount: number;
    fundingReceiptsWithProof: number;
    fundingProofCoverage: number;
    payrollEntriesCount: number;
    payrollEntriesWithProof: number;
    payrollProofCoverage: number;
    expenseEntriesCount: number;
    expenseEntriesWithProof: number;
    expenseProofCoverage: number;
  };
  sourceAccountability: Array<{
    sourceId: string;
    sourceCode: string;
    name: string;
    sourceType: string;
    currency: string;
    committedAmount: number;
    lifetimeReceived: number;
    receivedInPeriod: number;
    payrollAllocatedInPeriod: number;
    procurementAllocatedInPeriod: number;
    manualExpenseAllocatedInPeriod: number;
    totalAllocatedInPeriod: number;
    unallocatedInPeriod: number;
  }>;
  trend: Array<{ periodMonth: string; totalIncome: number; totalExpense: number; net: number }>;
  transferLedger: Array<{
    receiptId: string;
    receivedOn: string;
    sourceId: string;
    sourceCode: string;
    sourceName: string;
    sourceType: string;
    amount: number;
    currency: string;
    reference: string | null;
    proofUrl: string | null;
    notes: string | null;
    recordedBy: string | null;
  }>;
  collectionLedger: Array<{
    paymentId: string;
    receivedOn: string;
    playerCode: string;
    playerName: string;
    guardianName: string | null;
    method: string;
    amount: number;
    currency: string;
    paymentReference: string | null;
    externalReference: string | null;
    recordedBy: string | null;
  }>;
  utilizationLedger: Array<{
    happenedOn: string;
    kind: string;
    referenceCode: string;
    details: string;
    amount: number;
    currency: string;
    fundingSourceCode: string | null;
    fundingSourceName: string | null;
    proofUrl: string | null;
  }>;
  closingStatement: string;
};

let ensureReportsPromise: Promise<void> | null = null;

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function ratio(part: number, total: number): number {
  if (total <= 0) return 0;
  return round2((part / total) * 100);
}

function cleanOptional(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function normalizedLimit(value: number, max = 1000): number {
  return Math.min(Math.max(value, 1), max);
}

function parseDateStrict(value: string, field: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new HttpError(400, `${field} must be in YYYY-MM-DD format`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} is invalid`);
  return d;
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function resolvePeriodBounds(input: FinanceTransparencyQueryInput): PeriodBounds {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const toDate = input.to ? parseDateStrict(input.to, 'to') : todayUtc;
  const fromDate = input.from
    ? parseDateStrict(input.from, 'from')
    : new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), 1));
  if (fromDate.getTime() > toDate.getTime()) throw new HttpError(400, 'from must be before or equal to to');
  return {
    from: isoDate(fromDate),
    to: isoDate(toDate),
    days: Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1
  };
}

function proof(reference: string | null, proofUrl: string | null): string {
  return cleanOptional(proofUrl) ?? cleanOptional(reference) ?? '-';
}

function status(reference: string | null, proofUrl: string | null): 'verified' | 'missing' {
  return cleanOptional(proofUrl) || cleanOptional(reference) ? 'verified' : 'missing';
}

function categoryLabel(value: string): string {
  const map: Record<string, string> = {
    coaching_salaries: 'Coaching Salaries',
    equipment: 'Training Equipment',
    facility: 'Facility',
    transport: 'Transport',
    administration: 'Administration',
    other: 'Other'
  };
  return map[value] ?? value;
}

function describeBalance(closingBalance: number): string {
  if (closingBalance < 0) return 'The academy operated at a temporary deficit due to commitments exceeding inflows.';
  if (closingBalance > 0) return 'The academy closed the period with a positive working balance.';
  return 'The academy closed the period at break-even.';
}

function classifyInventoryCategory(raw: string): ExpenseCategory {
  const value = raw.toLowerCase();
  if (value.includes('equip') || value.includes('kit')) return 'equipment';
  if (value.includes('facility')) return 'facility';
  if (value.includes('transport')) return 'transport';
  if (value.includes('service') || value.includes('admin')) return 'administration';
  if (value.includes('salary') || value.includes('coach')) return 'coaching_salaries';
  return 'other';
}

function classifyProcurement(rawCategories: string | null, title: string, budgetLine: string | null): ExpenseCategory {
  const combined = `${rawCategories ?? ''} ${title} ${budgetLine ?? ''}`.toLowerCase();
  if (combined.includes('salary') || combined.includes('coach')) return 'coaching_salaries';
  if (combined.includes('equip') || combined.includes('kit') || combined.includes('training')) return 'equipment';
  if (combined.includes('facility') || combined.includes('venue')) return 'facility';
  if (combined.includes('transport')) return 'transport';
  if (combined.includes('admin') || combined.includes('service')) return 'administration';
  return 'other';
}

function aggregateByCategory(entries: ExpenseEntry[], category: ExpenseCategory): { total: number; rows: ExpenseEntry[] } {
  const rows = entries.filter((entry) => entry.category === category);
  return { total: round2(rows.reduce((sum, row) => sum + row.amount, 0)), rows };
}

function buildTrend(incomeEntries: IncomeEntry[], expenseEntries: ExpenseEntry[]) {
  const map = new Map<string, { income: number; expense: number }>();
  incomeEntries.forEach((entry) => {
    const key = entry.date.slice(0, 7);
    const item = map.get(key) ?? { income: 0, expense: 0 };
    item.income += entry.amount;
    map.set(key, item);
  });
  expenseEntries.forEach((entry) => {
    const key = entry.date.slice(0, 7);
    const item = map.get(key) ?? { income: 0, expense: 0 };
    item.expense += entry.amount;
    map.set(key, item);
  });
  return Array.from(map.entries())
    .map(([periodMonth, value]) => ({
      periodMonth,
      totalIncome: round2(value.income),
      totalExpense: round2(value.expense),
      net: round2(value.income - value.expense)
    }))
    .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
}

function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map((value) => csvField(value)).join(',');
}

async function ensureReportsInfrastructure(): Promise<void> {
  await ensureOperationsInfrastructure();
  if (!ensureReportsPromise) {
    ensureReportsPromise = (async () => {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS financial_income_entries (
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
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS financial_expense_entries (
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
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_fin_income_date ON financial_income_entries(entry_date DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_fin_income_source ON financial_income_entries(source_id, entry_date DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_fin_expense_date ON financial_expense_entries(entry_date DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_fin_expense_source ON financial_expense_entries(source_id, entry_date DESC)`);
    })().catch((error) => {
      ensureReportsPromise = null;
      throw error;
    });
  }
  await ensureReportsPromise;
}

function byDateDesc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf());
}

async function fetchTransferLedger(period: PeriodBounds, sourceId: string | null, limit: number) {
  const result = await pool.query<{
    receipt_id: string;
    received_on: string;
    source_id: string;
    source_code: string;
    source_name: string;
    source_type: string;
    amount: string;
    currency: string;
    reference: string | null;
    proof_url: string | null;
    notes: string | null;
    recorded_by: string | null;
  }>(
    `
      SELECT
        fr.id AS receipt_id,
        fr.received_on::text,
        fs.id::text AS source_id,
        fs.source_code,
        fs.name AS source_name,
        fs.source_type,
        fr.received_amount::text AS amount,
        fr.currency,
        fr.reference,
        fr.proof_url,
        fr.notes,
        fr.recorded_by
      FROM funding_receipts fr
      INNER JOIN funding_sources fs ON fs.id = fr.funding_source_id
      WHERE
        fr.received_on BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR fr.funding_source_id = $3::uuid)
      ORDER BY fr.received_on DESC, fr.created_at DESC
      LIMIT $4
    `,
    [period.from, period.to, sourceId, normalizedLimit(limit, 2000)]
  );

  return result.rows.map((row) => ({
    receiptId: row.receipt_id,
    receivedOn: row.received_on,
    sourceId: row.source_id,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    sourceType: row.source_type,
    amount: toNumber(row.amount),
    currency: row.currency,
    reference: row.reference,
    proofUrl: row.proof_url,
    notes: row.notes,
    recordedBy: row.recorded_by
  }));
}

async function fetchCollectionLedger(period: PeriodBounds, sourceId: string | null, limit: number) {
  if (sourceId) return [] as FinancialTransparencyReport['collectionLedger'];

  const result = await pool.query<{
    payment_id: string;
    received_on: string;
    method: string;
    amount: string;
    currency: string;
    payment_reference: string | null;
    external_reference: string | null;
    recorded_by: string | null;
    player_code: string;
    player_name: string;
    guardian_name: string | null;
  }>(
    `
      SELECT
        p.id AS payment_id,
        p.received_on::text,
        p.method::text,
        p.amount::text,
        p.currency,
        p.payment_reference,
        p.external_reference,
        p.recorded_by,
        pl.player_code,
        CONCAT(pl.first_name, ' ', pl.last_name) AS player_name,
        pg.guardian_name
      FROM payments p
      INNER JOIN players pl ON pl.id = p.player_id
      LEFT JOIN LATERAL (
        SELECT CONCAT(g.first_name, ' ', g.last_name) AS guardian_name
        FROM guardians g
        INNER JOIN player_guardians x ON x.guardian_id = g.id
        WHERE x.player_id = pl.id
        ORDER BY x.is_billing_contact DESC, x.is_primary_contact DESC, x.created_at ASC
        LIMIT 1
      ) pg ON TRUE
      WHERE p.received_on BETWEEN $1::date AND $2::date
      ORDER BY p.received_on DESC, p.created_at DESC
      LIMIT $3
    `,
    [period.from, period.to, normalizedLimit(limit, 2000)]
  );

  return result.rows.map((row) => ({
    paymentId: row.payment_id,
    receivedOn: row.received_on,
    playerCode: row.player_code,
    playerName: row.player_name,
    guardianName: row.guardian_name,
    method: row.method,
    amount: toNumber(row.amount),
    currency: row.currency,
    paymentReference: row.payment_reference,
    externalReference: row.external_reference,
    recordedBy: row.recorded_by
  }));
}

async function fetchManualIncomeEntries(period: PeriodBounds, sourceId: string | null, limit: number) {
  const result = await pool.query<{
    entry_date: string;
    source: string;
    income_type: string;
    description: string | null;
    amount: string;
    currency: string;
    reference: string | null;
    proof_url: string | null;
    recorded_by: string | null;
  }>(
    `
      SELECT
        entry_date::text,
        source,
        income_type,
        description,
        amount::text,
        currency,
        reference,
        proof_url,
        recorded_by
      FROM financial_income_entries
      WHERE
        entry_date BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR source_id = $3::uuid)
      ORDER BY entry_date DESC, created_at DESC
      LIMIT $4
    `,
    [period.from, period.to, sourceId, normalizedLimit(limit, 2000)]
  );

  return result.rows.map<IncomeEntry>((row) => {
    const sourceType: IncomeType =
      row.income_type === 'fees' || row.income_type === 'donation' || row.income_type === 'sponsor' ? row.income_type : 'other';
    return {
      date: row.entry_date,
      sourceType,
      source: row.source,
      description: cleanOptional(row.description) ?? row.source,
      amount: toNumber(row.amount),
      currency: row.currency,
      reference: row.reference,
      proofUrl: row.proof_url,
      proof: proof(row.reference, row.proof_url),
      status: status(row.reference, row.proof_url),
      recordedBy: row.recorded_by
    };
  });
}

async function fetchPayrollExpenseEntries(period: PeriodBounds, sourceId: string | null, limit: number) {
  const result = await pool.query<{
    happened_on: string;
    period_month: string;
    amount_paid: string;
    currency: string;
    payment_reference: string | null;
    proof_url: string | null;
    created_by: string | null;
    full_name: string;
    role_title: string;
    funding_source_code: string | null;
    funding_source_name: string | null;
  }>(
    `
      SELECT
        COALESCE(sp.payment_date, TO_DATE(sp.period_month || '-01', 'YYYY-MM-DD'))::text AS happened_on,
        sp.period_month,
        sp.amount_paid::text,
        sp.currency,
        sp.payment_reference,
        sp.proof_url,
        sp.created_by,
        sm.full_name,
        sm.role_title,
        fs.source_code AS funding_source_code,
        fs.name AS funding_source_name
      FROM staff_payments sp
      INNER JOIN staff_members sm ON sm.id = sp.staff_member_id
      LEFT JOIN funding_sources fs ON fs.id = sp.funding_source_id
      WHERE
        sp.amount_paid > 0
        AND COALESCE(sp.payment_date, TO_DATE(sp.period_month || '-01', 'YYYY-MM-DD')) BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR sp.funding_source_id = $3::uuid)
      ORDER BY happened_on DESC, sp.updated_at DESC
      LIMIT $4
    `,
    [period.from, period.to, sourceId, normalizedLimit(limit, 2000)]
  );

  return result.rows.map<ExpenseEntry>((row) => ({
    date: row.happened_on,
    category: 'coaching_salaries',
    description: `${row.full_name} (${row.role_title}) salary for ${row.period_month}`,
    amount: toNumber(row.amount_paid),
    currency: row.currency,
    reference: row.payment_reference,
    proofUrl: row.proof_url,
    proof: proof(row.payment_reference, row.proof_url),
    status: status(row.payment_reference, row.proof_url),
    sourceCode: row.funding_source_code,
    sourceName: row.funding_source_name,
    actor: row.created_by
  }));
}

async function fetchProcurementExpenseEntries(
  period: PeriodBounds,
  sourceId: string | null,
  limit: number,
  currency: string
) {
  const result = await pool.query<{
    pr_number: string;
    title: string;
    supplier_name: string | null;
    quote_reference: string | null;
    budget_line: string | null;
    need_categories: string | null;
    total_estimated_amount: string;
    happened_on: string;
    funding_source_code: string | null;
    funding_source_name: string | null;
  }>(
    `
      SELECT
        pr.pr_number,
        pr.title,
        pr.supplier_name,
        pr.quote_reference,
        pr.budget_line,
        STRING_AGG(DISTINCT n.category, ',') AS need_categories,
        pr.total_estimated_amount::text,
        COALESCE(pr.updated_at::date, pr.created_at::date)::text AS happened_on,
        fs.source_code AS funding_source_code,
        fs.name AS funding_source_name
      FROM procurement_requests pr
      LEFT JOIN procurement_request_needs prn ON prn.procurement_request_id = pr.id
      LEFT JOIN club_needs n ON n.id = prn.need_id
      LEFT JOIN funding_sources fs ON fs.id = pr.funding_source_id
      WHERE
        pr.status IN ('delivered', 'closed')
        AND COALESCE(pr.updated_at::date, pr.created_at::date) BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR pr.funding_source_id = $3::uuid)
      GROUP BY pr.id, fs.source_code, fs.name
      ORDER BY happened_on DESC, pr.updated_at DESC
      LIMIT $4
    `,
    [period.from, period.to, sourceId, normalizedLimit(limit, 2000)]
  );

  return result.rows.map<ExpenseEntry>((row) => {
    const reference = cleanOptional(row.quote_reference) ?? row.pr_number;
    return {
      date: row.happened_on,
      category: classifyProcurement(row.need_categories, row.title, row.budget_line),
      description: `Procurement ${row.pr_number}: ${row.title}${row.supplier_name ? ` (${row.supplier_name})` : ''}`,
      amount: toNumber(row.total_estimated_amount),
      currency,
      reference,
      proofUrl: null,
      proof: proof(reference, null),
      status: status(reference, null),
      sourceCode: row.funding_source_code,
      sourceName: row.funding_source_name,
      actor: null
    };
  });
}

async function fetchInventoryExpenseEntries(period: PeriodBounds, sourceId: string | null, limit: number, currency: string) {
  if (sourceId) return [] as ExpenseEntry[];

  const result = await pool.query<{
    movement_date: string;
    movement_type: string;
    quantity: string;
    unit_cost: string | null;
    total_cost: string | null;
    reference_id: string | null;
    created_by: string | null;
    item_code: string;
    item_name: string;
    item_category: string;
  }>(
    `
      SELECT
        sm.movement_date::text,
        sm.movement_type,
        sm.quantity::text,
        sm.unit_cost::text,
        sm.total_cost::text,
        sm.reference_id,
        sm.created_by,
        ii.item_code,
        ii.name AS item_name,
        ii.category AS item_category
      FROM stock_movements sm
      INNER JOIN inventory_items ii ON ii.id = sm.inventory_item_id
      WHERE
        sm.movement_date BETWEEN $1::date AND $2::date
        AND sm.movement_type IN ('out', 'adjustment')
        AND COALESCE(sm.total_cost, sm.unit_cost * ABS(sm.quantity), 0) > 0
      ORDER BY sm.movement_date DESC, sm.created_at DESC
      LIMIT $3
    `,
    [period.from, period.to, normalizedLimit(limit, 2000)]
  );

  return result.rows.map<ExpenseEntry>((row) => {
    const amount = toNumber(row.total_cost) || toNumber(row.unit_cost) * Math.abs(toNumber(row.quantity));
    return {
      date: row.movement_date,
      category: classifyInventoryCategory(row.item_category),
      description: `Inventory ${row.movement_type}: ${row.item_name} (${row.item_code})`,
      amount: round2(amount),
      currency,
      reference: row.reference_id,
      proofUrl: null,
      proof: proof(row.reference_id, null),
      status: status(row.reference_id, null),
      sourceCode: null,
      sourceName: null,
      actor: row.created_by
    };
  });
}

async function fetchManualExpenseEntries(period: PeriodBounds, sourceId: string | null, limit: number) {
  const result = await pool.query<{
    entry_date: string;
    category: string;
    description: string;
    amount: string;
    currency: string;
    reference: string | null;
    proof_url: string | null;
    recorded_by: string | null;
    source_code: string | null;
    source_name: string | null;
  }>(
    `
      SELECT
        fe.entry_date::text,
        fe.category,
        fe.description,
        fe.amount::text,
        fe.currency,
        fe.reference,
        fe.proof_url,
        fe.recorded_by,
        fs.source_code,
        fs.name AS source_name
      FROM financial_expense_entries fe
      LEFT JOIN funding_sources fs ON fs.id = fe.source_id
      WHERE
        fe.entry_date BETWEEN $1::date AND $2::date
        AND ($3::uuid IS NULL OR fe.source_id = $3::uuid)
      ORDER BY fe.entry_date DESC, fe.created_at DESC
      LIMIT $4
    `,
    [period.from, period.to, sourceId, normalizedLimit(limit, 2000)]
  );

  return result.rows.map<ExpenseEntry>((row) => ({
    date: row.entry_date,
    category:
      row.category === 'coaching_salaries' ||
      row.category === 'equipment' ||
      row.category === 'facility' ||
      row.category === 'transport' ||
      row.category === 'administration'
        ? row.category
        : 'other',
    description: row.description,
    amount: toNumber(row.amount),
    currency: row.currency,
    reference: row.reference,
    proofUrl: row.proof_url,
    proof: proof(row.reference, row.proof_url),
    status: status(row.reference, row.proof_url),
    sourceCode: row.source_code,
    sourceName: row.source_name,
    actor: row.recorded_by
  }));
}

async function fetchOpeningTotals(fromDate: string, sourceId: string | null): Promise<{ inflows: number; outflows: number }> {
  const [
    fundingBefore,
    collectionsBefore,
    manualIncomeBefore,
    payrollBefore,
    procurementBefore,
    stockBefore,
    manualExpenseBefore
  ] = await Promise.all([
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(received_amount), 0)::text AS total
        FROM funding_receipts
        WHERE received_on < $1::date
          AND ($2::uuid IS NULL OR funding_source_id = $2::uuid)
      `,
      [fromDate, sourceId]
    ),
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(amount), 0)::text AS total
        FROM payments
        WHERE received_on < $1::date
          AND $2::uuid IS NULL
      `,
      [fromDate, sourceId]
    ),
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(amount), 0)::text AS total
        FROM financial_income_entries
        WHERE entry_date < $1::date
          AND ($2::uuid IS NULL OR source_id = $2::uuid)
      `,
      [fromDate, sourceId]
    ),
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(amount_paid), 0)::text AS total
        FROM staff_payments
        WHERE amount_paid > 0
          AND COALESCE(payment_date, TO_DATE(period_month || '-01', 'YYYY-MM-DD')) < $1::date
          AND ($2::uuid IS NULL OR funding_source_id = $2::uuid)
      `,
      [fromDate, sourceId]
    ),
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(total_estimated_amount), 0)::text AS total
        FROM procurement_requests
        WHERE status IN ('delivered', 'closed')
          AND COALESCE(updated_at::date, created_at::date) < $1::date
          AND ($2::uuid IS NULL OR funding_source_id = $2::uuid)
      `,
      [fromDate, sourceId]
    ),
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(COALESCE(total_cost, unit_cost * ABS(quantity), 0)), 0)::text AS total
        FROM stock_movements
        WHERE movement_type IN ('out', 'adjustment')
          AND movement_date < $1::date
          AND COALESCE(total_cost, unit_cost * ABS(quantity), 0) > 0
          AND $2::uuid IS NULL
      `,
      [fromDate, sourceId]
    ),
    pool.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(amount), 0)::text AS total
        FROM financial_expense_entries
        WHERE entry_date < $1::date
          AND ($2::uuid IS NULL OR source_id = $2::uuid)
      `,
      [fromDate, sourceId]
    )
  ]);

  const inflows =
    toNumber(fundingBefore.rows[0]?.total) + toNumber(collectionsBefore.rows[0]?.total) + toNumber(manualIncomeBefore.rows[0]?.total);
  const outflows =
    toNumber(payrollBefore.rows[0]?.total) +
    toNumber(procurementBefore.rows[0]?.total) +
    toNumber(stockBefore.rows[0]?.total) +
    toNumber(manualExpenseBefore.rows[0]?.total);

  return { inflows: round2(inflows), outflows: round2(outflows) };
}

export async function getFinancialTransparencyReport(input: FinanceTransparencyQueryInput): Promise<FinancialTransparencyReport> {
  await ensureReportsInfrastructure();
  const period = resolvePeriodBounds(input);
  const limit = normalizedLimit(input.limit, 1000);
  const sourceId = input.sourceId ?? null;
  const academy = await getAcademyProfileSettings();

  const [openingTotals, transferLedger, collectionLedger, manualIncomeEntries, payrollExpenses, procurementExpenses, inventoryExpenses, manualExpenses] =
    await Promise.all([
      fetchOpeningTotals(period.from, sourceId),
      fetchTransferLedger(period, sourceId, limit),
      fetchCollectionLedger(period, sourceId, limit),
      fetchManualIncomeEntries(period, sourceId, limit),
      fetchPayrollExpenseEntries(period, sourceId, limit),
      fetchProcurementExpenseEntries(period, sourceId, limit, academy.currency),
      fetchInventoryExpenseEntries(period, sourceId, limit, academy.currency),
      fetchManualExpenseEntries(period, sourceId, limit)
    ]);

  const fundingIncomeEntries: IncomeEntry[] = transferLedger.map((row) => {
    const sourceType: IncomeType = row.sourceType === 'sponsor' ? 'sponsor' : row.sourceType === 'donor' ? 'donation' : 'other';
    return {
      date: row.receivedOn,
      sourceType,
      source: `${row.sourceCode} - ${row.sourceName}`,
      description: cleanOptional(row.notes) ?? 'Funding receipt',
      amount: row.amount,
      currency: row.currency,
      reference: row.reference,
      proofUrl: row.proofUrl,
      proof: proof(row.reference, row.proofUrl),
      status: status(row.reference, row.proofUrl),
      recordedBy: row.recordedBy
    };
  });

  const collectionIncomeEntries: IncomeEntry[] = collectionLedger.map((row) => {
    const reference = cleanOptional(row.paymentReference) ?? cleanOptional(row.externalReference);
    return {
      date: row.receivedOn,
      sourceType: 'fees',
      source: 'Player Fees',
      description: `${row.playerName} (${row.playerCode}) collection via ${row.method.toUpperCase()}`,
      amount: row.amount,
      currency: row.currency,
      reference,
      proofUrl: null,
      proof: proof(reference, null),
      status: status(reference, null),
      recordedBy: row.recordedBy
    };
  });

  const incomeBreakdown = byDateDesc([...fundingIncomeEntries, ...collectionIncomeEntries, ...manualIncomeEntries]).slice(0, limit);
  const allExpenseEntries = byDateDesc([...payrollExpenses, ...procurementExpenses, ...inventoryExpenses, ...manualExpenses]).slice(0, limit);

  const coachingAndStaff = aggregateByCategory(allExpenseEntries, 'coaching_salaries');
  const trainingEquipment = aggregateByCategory(allExpenseEntries, 'equipment');
  const administration = aggregateByCategory(allExpenseEntries, 'administration');
  const facility = aggregateByCategory(allExpenseEntries, 'facility');
  const transport = aggregateByCategory(allExpenseEntries, 'transport');
  const other = aggregateByCategory(allExpenseEntries, 'other');

  const facilitiesAndTransport = { total: round2(facility.total + transport.total), rows: [...facility.rows, ...transport.rows] };
  const totalExpenditure = round2(
    coachingAndStaff.total + trainingEquipment.total + administration.total + facilitiesAndTransport.total + other.total
  );
  const totalIncome = round2(incomeBreakdown.reduce((sum, row) => sum + row.amount, 0));

  const playerFeesCollected = round2(collectionIncomeEntries.reduce((sum, row) => sum + row.amount, 0));
  const donationsReceived = round2(
    [...fundingIncomeEntries, ...manualIncomeEntries]
      .filter((row) => row.sourceType === 'donation' || row.sourceType === 'sponsor')
      .reduce((sum, row) => sum + row.amount, 0)
  );
  const otherIncome = round2(Math.max(totalIncome - playerFeesCollected - donationsReceived, 0));

  const openingBalance = round2(openingTotals.inflows - openingTotals.outflows);
  const totalFundsAvailable = round2(openingBalance + totalIncome);
  const closingBalance = round2(totalFundsAvailable - totalExpenditure);
  const fundingReceived = round2(fundingIncomeEntries.reduce((sum, row) => sum + row.amount, 0));
  const payrollPaid = round2(payrollExpenses.reduce((sum, row) => sum + row.amount, 0));
  const procurementSpend = round2(procurementExpenses.reduce((sum, row) => sum + row.amount, 0));
  const inventoryUsageSpend = round2(inventoryExpenses.reduce((sum, row) => sum + row.amount, 0));
  const netMovement = round2(totalIncome - totalExpenditure);

  const budgetAllocationRaw = [
    { category: 'Coaching Salaries', amount: coachingAndStaff.total },
    { category: 'Training Equipment', amount: trainingEquipment.total },
    { category: 'Administration', amount: administration.total },
    { category: 'Facilities & Transport', amount: facilitiesAndTransport.total },
    { category: 'Other', amount: other.total }
  ].filter((row) => row.amount > 0);

  const budgetAllocation = budgetAllocationRaw.map((row) => ({
    category: row.category,
    amount: row.amount,
    percentage: ratio(row.amount, totalExpenditure)
  }));

  const accountability = [...incomeBreakdown, ...allExpenseEntries]
    .map((entry) => ({
      date: entry.date,
      category: 'sourceType' in entry ? `Income - ${entry.source}` : categoryLabel(entry.category),
      transaction: entry.description,
      amount: entry.amount,
      currency: entry.currency,
      proof: entry.proof,
      status: entry.status
    }))
    .sort((a, b) => dayjs(b.date).valueOf() - dayjs(a.date).valueOf())
    .slice(0, limit);

  const [fundingProofResult, payrollProofResult] = await Promise.all([
    pool.query<{ total: string; with_proof: string }>(
      `
        SELECT
          COUNT(*)::text AS total,
          COALESCE(SUM(CASE WHEN COALESCE(NULLIF(TRIM(reference), ''), NULLIF(TRIM(proof_url), '')) IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS with_proof
        FROM funding_receipts
        WHERE received_on BETWEEN $1::date AND $2::date
          AND ($3::uuid IS NULL OR funding_source_id = $3::uuid)
      `,
      [period.from, period.to, sourceId]
    ),
    pool.query<{ total: string; with_proof: string }>(
      `
        SELECT
          COUNT(*)::text AS total,
          COALESCE(SUM(CASE WHEN COALESCE(NULLIF(TRIM(payment_reference), ''), NULLIF(TRIM(proof_url), '')) IS NOT NULL THEN 1 ELSE 0 END), 0)::text AS with_proof
        FROM staff_payments
        WHERE amount_paid > 0
          AND COALESCE(payment_date, TO_DATE(period_month || '-01', 'YYYY-MM-DD')) BETWEEN $1::date AND $2::date
          AND ($3::uuid IS NULL OR funding_source_id = $3::uuid)
      `,
      [period.from, period.to, sourceId]
    )
  ]);

  const fundingReceiptsCount = toNumber(fundingProofResult.rows[0]?.total);
  const fundingReceiptsWithProof = toNumber(fundingProofResult.rows[0]?.with_proof);
  const payrollEntriesCount = toNumber(payrollProofResult.rows[0]?.total);
  const payrollEntriesWithProof = toNumber(payrollProofResult.rows[0]?.with_proof);
  const expenseEntriesCount = allExpenseEntries.length;
  const expenseEntriesWithProof = allExpenseEntries.filter((row) => row.status === 'verified').length;

  const sourceResult = await pool.query<{
    source_id: string;
    source_code: string;
    name: string;
    source_type: string;
    currency: string;
    committed_amount: string;
    lifetime_received: string;
    received_in_period: string;
    payroll_allocated_in_period: string;
    procurement_allocated_in_period: string;
    manual_expense_allocated_in_period: string;
  }>(
    `
      SELECT
        fs.id::text AS source_id,
        fs.source_code,
        fs.name,
        fs.source_type,
        fs.currency,
        fs.committed_amount::text,
        fs.received_amount::text AS lifetime_received,
        COALESCE((
          SELECT SUM(fr.received_amount)
          FROM funding_receipts fr
          WHERE fr.funding_source_id = fs.id
            AND fr.received_on BETWEEN $1::date AND $2::date
        ), 0)::text AS received_in_period,
        COALESCE((
          SELECT SUM(sp.amount_paid)
          FROM staff_payments sp
          WHERE sp.funding_source_id = fs.id
            AND sp.amount_paid > 0
            AND COALESCE(sp.payment_date, TO_DATE(sp.period_month || '-01', 'YYYY-MM-DD')) BETWEEN $1::date AND $2::date
        ), 0)::text AS payroll_allocated_in_period,
        COALESCE((
          SELECT SUM(pr.total_estimated_amount)
          FROM procurement_requests pr
          WHERE pr.funding_source_id = fs.id
            AND pr.status IN ('delivered', 'closed')
            AND COALESCE(pr.updated_at::date, pr.created_at::date) BETWEEN $1::date AND $2::date
        ), 0)::text AS procurement_allocated_in_period,
        COALESCE((
          SELECT SUM(fe.amount)
          FROM financial_expense_entries fe
          WHERE fe.source_id = fs.id
            AND fe.entry_date BETWEEN $1::date AND $2::date
        ), 0)::text AS manual_expense_allocated_in_period
      FROM funding_sources fs
      WHERE fs.is_active = TRUE
        AND ($3::uuid IS NULL OR fs.id = $3::uuid)
      ORDER BY fs.name ASC
      LIMIT $4
    `,
    [period.from, period.to, sourceId, limit]
  );

  const sourceAccountability = sourceResult.rows.map((row) => {
    const payrollAllocatedInPeriod = toNumber(row.payroll_allocated_in_period);
    const procurementAllocatedInPeriod = toNumber(row.procurement_allocated_in_period);
    const manualExpenseAllocatedInPeriod = toNumber(row.manual_expense_allocated_in_period);
    const receivedInPeriod = toNumber(row.received_in_period);
    const totalAllocatedInPeriod = round2(payrollAllocatedInPeriod + procurementAllocatedInPeriod + manualExpenseAllocatedInPeriod);
    return {
      sourceId: row.source_id,
      sourceCode: row.source_code,
      name: row.name,
      sourceType: row.source_type,
      currency: row.currency,
      committedAmount: toNumber(row.committed_amount),
      lifetimeReceived: toNumber(row.lifetime_received),
      receivedInPeriod,
      payrollAllocatedInPeriod,
      procurementAllocatedInPeriod,
      manualExpenseAllocatedInPeriod,
      totalAllocatedInPeriod,
      unallocatedInPeriod: round2(receivedInPeriod - totalAllocatedInPeriod)
    };
  });

  const utilizationLedger = allExpenseEntries.map((row) => ({
    happenedOn: row.date,
    kind: row.category,
    referenceCode: row.reference ?? '-',
    details: row.description,
    amount: row.amount,
    currency: row.currency,
    fundingSourceCode: row.sourceCode,
    fundingSourceName: row.sourceName,
    proofUrl: row.proofUrl
  }));

  return {
    period,
    overview: {
      openingBalance,
      playerFeesCollected,
      donationsReceived,
      otherIncome,
      totalIncome,
      coachingSalaries: coachingAndStaff.total,
      trainingEquipment: trainingEquipment.total,
      administration: administration.total,
      facilitiesAndTransport: facilitiesAndTransport.total,
      otherExpenditure: other.total,
      totalExpenditure,
      totalFundsAvailable,
      closingBalance,
      deficitAmount: closingBalance < 0 ? Math.abs(closingBalance) : 0,
      surplusAmount: closingBalance > 0 ? closingBalance : 0,
      explanation: describeBalance(closingBalance)
    },
    summary: {
      openingBalance,
      fundingReceived,
      playerFeeCollections: playerFeesCollected,
      totalInflows: totalIncome,
      payrollPaid,
      procurementSpend,
      inventoryUsageSpend,
      totalOutflows: totalExpenditure,
      netMovement,
      closingBalance
    },
    incomeBreakdown,
    expenditureBreakdown: {
      coachingAndStaff,
      trainingEquipment,
      administration,
      facilitiesAndTransport,
      other,
      totalExpenditure
    },
    budgetAllocation,
    accountability,
    proof: {
      fundingReceiptsCount,
      fundingReceiptsWithProof,
      fundingProofCoverage: ratio(fundingReceiptsWithProof, fundingReceiptsCount),
      payrollEntriesCount,
      payrollEntriesWithProof,
      payrollProofCoverage: ratio(payrollEntriesWithProof, payrollEntriesCount),
      expenseEntriesCount,
      expenseEntriesWithProof,
      expenseProofCoverage: ratio(expenseEntriesWithProof, expenseEntriesCount)
    },
    sourceAccountability,
    trend: buildTrend(incomeBreakdown, allExpenseEntries),
    transferLedger: transferLedger.slice(0, limit),
    collectionLedger: collectionLedger.slice(0, limit),
    utilizationLedger: utilizationLedger.slice(0, limit),
    closingStatement:
      'This report was generated by the Dynaverse Football Academy MIS to ensure financial transparency in the management of academy funds.'
  };
}

export async function buildFinancialTransparencyCsv(input: FinanceTransparencyQueryInput): Promise<{ filename: string; csv: string }> {
  const report = await getFinancialTransparencyReport(input);
  const lines: string[] = [];

  lines.push(csvRow(['Dynaverse Football Academy - Financial Transparency & Accountability Report']));
  lines.push(csvRow([`Period: ${report.period.from} to ${report.period.to}`]));
  lines.push('');

  lines.push(csvRow(['EXECUTIVE SUMMARY']));
  lines.push(csvRow(['Opening Balance', report.overview.openingBalance]));
  lines.push(csvRow(['Player Fees Collected', report.overview.playerFeesCollected]));
  lines.push(csvRow(['Donations Received', report.overview.donationsReceived]));
  lines.push(csvRow(['Other Income', report.overview.otherIncome]));
  lines.push(csvRow(['Total Income', report.overview.totalIncome]));
  lines.push(csvRow(['Coaching Salaries', report.overview.coachingSalaries]));
  lines.push(csvRow(['Training Equipment', report.overview.trainingEquipment]));
  lines.push(csvRow(['Administration', report.overview.administration]));
  lines.push(csvRow(['Facilities & Transport', report.overview.facilitiesAndTransport]));
  lines.push(csvRow(['Other Expenditure', report.overview.otherExpenditure]));
  lines.push(csvRow(['Total Expenditure', report.overview.totalExpenditure]));
  lines.push(csvRow(['Closing Balance', report.overview.closingBalance]));
  lines.push(csvRow(['Explanation', report.overview.explanation]));
  lines.push('');

  lines.push(csvRow(['INCOME BREAKDOWN']));
  lines.push(csvRow(['Date', 'Source Type', 'Source', 'Description', 'Amount', 'Currency', 'Reference', 'Proof', 'Status']));
  report.incomeBreakdown.forEach((row) => {
    lines.push(csvRow([row.date, row.sourceType, row.source, row.description, row.amount, row.currency, row.reference, row.proof, row.status]));
  });
  lines.push('');

  lines.push(csvRow(['EXPENDITURE BREAKDOWN']));
  lines.push(csvRow(['Date', 'Category', 'Description', 'Amount', 'Currency', 'Reference', 'Funding Source', 'Proof', 'Status']));
  const expenseRows = [
    ...report.expenditureBreakdown.coachingAndStaff.rows,
    ...report.expenditureBreakdown.trainingEquipment.rows,
    ...report.expenditureBreakdown.administration.rows,
    ...report.expenditureBreakdown.facilitiesAndTransport.rows,
    ...report.expenditureBreakdown.other.rows
  ];
  expenseRows.forEach((row) => {
    lines.push(
      csvRow([
        row.date,
        row.category,
        row.description,
        row.amount,
        row.currency,
        row.reference,
        row.sourceCode ? `${row.sourceCode} - ${row.sourceName ?? ''}` : '',
        row.proof,
        row.status
      ])
    );
  });
  lines.push('');

  lines.push(csvRow(['BUDGET ALLOCATION']));
  lines.push(csvRow(['Category', 'Amount', 'Percentage']));
  report.budgetAllocation.forEach((row) => {
    lines.push(csvRow([row.category, row.amount, `${row.percentage.toFixed(2)}%`]));
  });
  lines.push('');

  lines.push(csvRow(['ACCOUNTABILITY / PROOF']));
  lines.push(csvRow(['Date', 'Category', 'Transaction', 'Amount', 'Currency', 'Proof', 'Status']));
  report.accountability.forEach((row) => {
    lines.push(csvRow([row.date, row.category, row.transaction, row.amount, row.currency, row.proof, row.status]));
  });
  lines.push('');

  lines.push(csvRow(['SOURCE ACCOUNTABILITY']));
  lines.push(csvRow(['Source', 'Type', 'Committed', 'Lifetime Received', 'Received in Period', 'Allocated in Period', 'Unallocated in Period']));
  report.sourceAccountability.forEach((row) => {
    lines.push(
      csvRow([
        `${row.sourceCode} - ${row.name}`,
        row.sourceType,
        row.committedAmount,
        row.lifetimeReceived,
        row.receivedInPeriod,
        row.totalAllocatedInPeriod,
        row.unallocatedInPeriod
      ])
    );
  });

  return {
    filename: `financial-transparency-${report.period.from}-to-${report.period.to}.csv`,
    csv: lines.join('\n')
  };
}

export async function buildFinancialTransparencyPdf(input: FinanceTransparencyQueryInput): Promise<{ filename: string; pdf: Buffer }> {
  const report = await getFinancialTransparencyReport(input);
  const academy = await getAcademyProfileSettings();
  const expenditureRows = [
    ...report.expenditureBreakdown.coachingAndStaff.rows,
    ...report.expenditureBreakdown.trainingEquipment.rows,
    ...report.expenditureBreakdown.administration.rows,
    ...report.expenditureBreakdown.facilitiesAndTransport.rows,
    ...report.expenditureBreakdown.other.rows
  ];
  const pdf = await buildFinancialTransparencyPdfDocument({
    academyName: academy.academyName,
    divisionLine: academy.divisionLine,
    periodFrom: report.period.from,
    periodTo: report.period.to,
    generatedOn: dayjs().format('YYYY-MM-DD'),
    overview: {
      openingBalance: report.overview.openingBalance,
      playerFeesCollected: report.overview.playerFeesCollected,
      donationsReceived: report.overview.donationsReceived,
      totalFundsAvailable: report.overview.totalFundsAvailable,
      coachingSalaries: report.overview.coachingSalaries,
      trainingEquipment: report.overview.trainingEquipment,
      administration: report.overview.administration,
      totalExpenditure: report.overview.totalExpenditure,
      closingBalance: report.overview.closingBalance,
      explanation: report.overview.explanation
    },
    incomeBreakdown: report.incomeBreakdown.map((row) => ({
      date: row.date,
      source: row.source,
      description: row.description,
      amount: row.amount,
      currency: row.currency
    })),
    expenditureBreakdown: expenditureRows.map((row) => ({
      date: row.date,
      category: row.category,
      description: row.description,
      amount: row.amount,
      currency: row.currency
    }))
    ,
    budgetAllocation: report.budgetAllocation,
    accountability: report.accountability.map((row) => ({
      transaction: row.transaction,
      proof: row.proof,
      status: row.status
    })),
    closingStatement: report.closingStatement,
    contactEmail: academy.contactEmail,
    contactPhone: academy.contactPhone
  });

  return {
    filename: `financial-transparency-${report.period.from}-to-${report.period.to}.pdf`,
    pdf
  };
}

export async function createManualIncomeEntry(input: CreateManualIncomeEntryInput): Promise<{ id: string }> {
  await ensureReportsInfrastructure();
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO financial_income_entries (
        entry_date,
        source_id,
        source,
        income_type,
        description,
        amount,
        currency,
        reference,
        proof_url,
        recorded_by
      )
      VALUES ($1::date, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `,
    [
      input.entryDate,
      input.sourceId ?? null,
      input.source,
      input.incomeType,
      cleanOptional(input.description),
      input.amount,
      input.currency.toUpperCase(),
      cleanOptional(input.reference),
      cleanOptional(input.proofUrl),
      cleanOptional(input.recordedBy) ?? 'admin'
    ]
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(500, 'Failed to create manual income entry');
  return { id: row.id };
}

export async function createManualExpenseEntry(input: CreateManualExpenseEntryInput): Promise<{ id: string }> {
  await ensureReportsInfrastructure();
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO financial_expense_entries (
        entry_date,
        source_id,
        category,
        description,
        amount,
        currency,
        reference,
        proof_url,
        recorded_by
      )
      VALUES ($1::date, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      input.entryDate,
      input.sourceId ?? null,
      input.category,
      input.description,
      input.amount,
      input.currency.toUpperCase(),
      cleanOptional(input.reference),
      cleanOptional(input.proofUrl),
      cleanOptional(input.recordedBy) ?? 'admin'
    ]
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(500, 'Failed to create manual expense entry');
  return { id: row.id };
}
