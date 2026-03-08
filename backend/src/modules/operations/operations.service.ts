import crypto from 'node:crypto';
import dayjs from 'dayjs';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { HttpError } from '../../utils/httpError.js';
import { appendAuditLog, getAcademyProfileSettings } from '../settings/settings.store.js';
import { buildSalarySlipPdf } from './operations.documents.js';
import type {
  CreateFundingSourceInput,
  CreateInventoryItemInput,
  CreateNeedInput,
  CreateProcurementRequestInput,
  CreateStaffMemberInput,
  CreateStaffPaymentInput,
  ReceiveFundingInput,
  ReceiveProcurementRequestInput,
  RecordStaffPaymentInput,
  RecordStockMovementInput,
  UpdateNeedInput
} from './operations.types.js';

type InventoryItemRow = {
  id: string;
  item_code: string;
  name: string;
  category: string;
  description: string | null;
  unit: string;
  stock_on_hand: string;
  minimum_stock_level: string;
  target_stock_level: string;
  reorder_quantity: string;
  is_active: boolean;
  updated_at: string;
};

type NeedRow = {
  id: string;
  need_code: string;
  category: string;
  need_name: string;
  description: string | null;
  quantity_needed: string;
  quantity_fulfilled: string;
  priority: string;
  required_by: string | null;
  estimated_cost: string;
  justification: string | null;
  status: string;
  funding_status: string;
  funding_source_id: string | null;
  funding_source_name: string | null;
  owner_name: string | null;
  inventory_item_id: string | null;
  inventory_item_name: string | null;
  created_by: string | null;
  updated_at: string;
};

type ProcurementRow = {
  id: string;
  pr_number: string;
  title: string;
  requested_by: string | null;
  approved_by: string | null;
  supplier_name: string | null;
  quote_reference: string | null;
  budget_line: string | null;
  funding_source_id: string | null;
  funding_source_name: string | null;
  expected_delivery_date: string | null;
  total_estimated_amount: string;
  status: string;
  notes: string | null;
  need_codes: string;
  created_at: string;
  updated_at: string;
};

type FundingSourceRow = {
  id: string;
  source_code: string;
  name: string;
  source_type: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  committed_amount: string;
  received_amount: string;
  currency: string;
  notes: string | null;
  is_active: boolean;
  updated_at: string;
};

type StaffMemberRow = {
  id: string;
  staff_code: string;
  full_name: string;
  role_title: string;
  rate_type: string;
  rate_amount: string;
  payment_method: string;
  contract_start: string | null;
  contract_end: string | null;
  is_active: boolean;
  notes: string | null;
  updated_at: string;
};

type StaffPaymentRow = {
  id: string;
  staff_member_id: string;
  staff_code: string;
  full_name: string;
  role_title: string;
  period_month: string;
  amount_due: string;
  amount_paid: string;
  currency: string;
  payment_date: string | null;
  payment_reference: string | null;
  proof_url: string | null;
  funding_source_id: string | null;
  funding_source_name: string | null;
  status: string;
  notes: string | null;
  created_by: string | null;
  updated_at: string;
};

type StaffPaymentSlipRow = {
  id: string;
  period_month: string;
  amount_due: string;
  amount_paid: string;
  currency: string;
  payment_date: string | null;
  payment_reference: string | null;
  status: string;
  staff_code: string;
  full_name: string;
  role_title: string;
  payment_method: string;
  funding_source_name: string | null;
};

type FundingReceiptRow = {
  id: string;
  received_amount: string;
  received_on: string;
};

type DashboardMetricsRow = {
  low_stock_items: number;
  open_needs: number;
  procurement_pipeline: number;
  pending_staff_payments: number;
  salary_outstanding: string;
  needs_budget_open: string;
};

let ensureOpsPromise: Promise<void> | null = null;

function normalizedLimit(value: number, max = 500): number {
  return Math.min(Math.max(value, 1), max);
}

function cleanOptional(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatStatusText(value: string): string {
  return value.replaceAll('_', ' ');
}

function nowActor(value: string | undefined): string {
  const cleaned = (value ?? '').trim();
  return cleaned.length > 0 ? cleaned : 'admin';
}

function makeCode(prefix: string): string {
  const year = new Date().getFullYear();
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${year}-${suffix}`;
}

async function safeAppendAudit(actor: string, action: string, section: string, details: unknown): Promise<void> {
  try {
    await appendAuditLog(actor, action, section, details);
  } catch {
    // Keep business flow successful even if audit log write fails.
  }
}

function mapInventoryItem(row: InventoryItemRow) {
  const stockOnHand = Number(row.stock_on_hand);
  const min = Number(row.minimum_stock_level);
  const target = Number(row.target_stock_level);
  const reorderQty = Number(row.reorder_quantity);
  return {
    id: row.id,
    itemCode: row.item_code,
    name: row.name,
    category: row.category,
    description: row.description,
    unit: row.unit,
    stockOnHand,
    minimumStockLevel: min,
    targetStockLevel: target,
    reorderQuantity: reorderQty,
    belowMinimum: stockOnHand < min,
    gapToMinimum: Math.max(min - stockOnHand, 0),
    gapToTarget: Math.max(Math.max(target, min) - stockOnHand, 0),
    isActive: row.is_active,
    updatedAt: row.updated_at
  };
}

function mapNeed(row: NeedRow) {
  const needed = Number(row.quantity_needed);
  const fulfilled = Number(row.quantity_fulfilled);
  return {
    id: row.id,
    needCode: row.need_code,
    category: row.category,
    needName: row.need_name,
    description: row.description,
    quantityNeeded: needed,
    quantityFulfilled: fulfilled,
    quantityRemaining: Math.max(needed - fulfilled, 0),
    priority: row.priority,
    requiredBy: row.required_by,
    estimatedCost: Number(row.estimated_cost),
    justification: row.justification,
    status: row.status,
    statusLabel: formatStatusText(row.status),
    fundingStatus: row.funding_status,
    fundingStatusLabel: formatStatusText(row.funding_status),
    fundingSourceId: row.funding_source_id,
    fundingSourceName: row.funding_source_name,
    ownerName: row.owner_name,
    inventoryItemId: row.inventory_item_id,
    inventoryItemName: row.inventory_item_name,
    createdBy: row.created_by,
    updatedAt: row.updated_at
  };
}

function computeStaffPaymentStatus(amountDue: number, amountPaid: number): 'pending' | 'part_paid' | 'paid' {
  if (amountPaid <= 0) {
    return 'pending';
  }
  if (amountPaid >= amountDue) {
    return 'paid';
  }
  return 'part_paid';
}

export async function ensureOperationsInfrastructure(): Promise<void> {
  if (!ensureOpsPromise) {
    ensureOpsPromise = (async () => {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

      await pool.query(`
        CREATE TABLE IF NOT EXISTS inventory_items (
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
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
          movement_type TEXT NOT NULL,
          quantity NUMERIC(12, 2) NOT NULL,
          unit_cost NUMERIC(12, 2),
          total_cost NUMERIC(12, 2),
          movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
          reference_type TEXT,
          reference_id TEXT,
          notes TEXT,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS funding_sources (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'donor',
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
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS funding_receipts (
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
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS club_needs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          need_code TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          need_name TEXT NOT NULL,
          description TEXT,
          quantity_needed NUMERIC(12, 2) NOT NULL DEFAULT 1,
          quantity_fulfilled NUMERIC(12, 2) NOT NULL DEFAULT 0,
          priority TEXT NOT NULL DEFAULT 'medium',
          required_by DATE,
          estimated_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
          justification TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          funding_status TEXT NOT NULL DEFAULT 'unfunded',
          funding_source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
          owner_name TEXT,
          inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS procurement_requests (
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
          status TEXT NOT NULL DEFAULT 'draft',
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS procurement_request_needs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          procurement_request_id UUID NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
          need_id UUID NOT NULL REFERENCES club_needs(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(procurement_request_id, need_id)
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_members (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_code TEXT NOT NULL UNIQUE,
          full_name TEXT NOT NULL,
          role_title TEXT NOT NULL,
          rate_type TEXT NOT NULL,
          rate_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT 'eft',
          contract_start DATE,
          contract_end DATE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_payments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          staff_member_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
          period_month TEXT NOT NULL,
          amount_due NUMERIC(12, 2) NOT NULL,
          amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
          currency CHAR(3) NOT NULL DEFAULT 'NAD',
          payment_date DATE,
          payment_reference TEXT,
          proof_url TEXT,
          funding_source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          notes TEXT,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(staff_member_id, period_month)
        )
      `);

      await pool.query('CREATE INDEX IF NOT EXISTS idx_inventory_items_stock ON inventory_items(stock_on_hand, minimum_stock_level)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_stock_movements_item_date ON stock_movements(inventory_item_id, movement_date DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_funding_receipts_source_date ON funding_receipts(funding_source_id, received_on DESC)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_club_needs_status_priority ON club_needs(status, priority, required_by)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_procurement_requests_status ON procurement_requests(status, expected_delivery_date)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_staff_payments_period_status ON staff_payments(period_month, status)');

      await pool.query(
        `
          INSERT INTO funding_sources (source_code, name, source_type, committed_amount, received_amount, currency)
          VALUES ('FUND-CORE', 'Core Academy Fund', 'internal', 0, 0, 'NAD')
          ON CONFLICT (source_code) DO NOTHING
        `
      );

      await pool.query(
        `
          INSERT INTO funding_receipts (
            funding_source_id,
            received_amount,
            currency,
            received_on,
            reference,
            notes,
            recorded_by
          )
          SELECT
            fs.id,
            fs.received_amount,
            fs.currency,
            CURRENT_DATE,
            'OPENING-BALANCE',
            'Opening balance migrated into funding receipt ledger',
            'system'
          FROM funding_sources fs
          WHERE fs.received_amount > 0
            AND NOT EXISTS (
              SELECT 1
              FROM funding_receipts fr
              WHERE fr.funding_source_id = fs.id
            )
        `
      );
    })().catch((error) => {
      ensureOpsPromise = null;
      throw error;
    });
  }

  await ensureOpsPromise;
}

export async function getOperationsDashboard(): Promise<{
  metrics: {
    lowStockItems: number;
    openNeeds: number;
    procurementPipeline: number;
    pendingStaffPayments: number;
    salaryOutstanding: number;
    needsBudgetOpen: number;
  };
  lowStockItems: Array<{
    id: string;
    itemCode: string;
    name: string;
    category: string;
    stockOnHand: number;
    minimumStockLevel: number;
    targetStockLevel: number;
    recommendedOrderQty: number;
  }>;
  criticalNeeds: ReturnType<typeof mapNeed>[];
}> {
  await ensureOperationsInfrastructure();

  const [metricsResult, lowStockResult, criticalNeedsResult] = await Promise.all([
    pool.query<DashboardMetricsRow>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM inventory_items WHERE is_active = TRUE AND stock_on_hand < minimum_stock_level) AS low_stock_items,
          (SELECT COUNT(*)::int FROM club_needs WHERE status IN ('open', 'approved', 'sourced', 'ordered')) AS open_needs,
          (SELECT COUNT(*)::int FROM procurement_requests WHERE status IN ('submitted', 'approved', 'ordered')) AS procurement_pipeline,
          (SELECT COUNT(*)::int FROM staff_payments WHERE status IN ('pending', 'part_paid')) AS pending_staff_payments,
          (SELECT COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0)::text FROM staff_payments WHERE status IN ('pending', 'part_paid')) AS salary_outstanding,
          (SELECT COALESCE(SUM(estimated_cost), 0)::text FROM club_needs WHERE status IN ('open', 'approved', 'sourced', 'ordered')) AS needs_budget_open
      `
    ),
    pool.query<InventoryItemRow>(
      `
        SELECT
          id,
          item_code,
          name,
          category,
          description,
          unit,
          stock_on_hand::text,
          minimum_stock_level::text,
          target_stock_level::text,
          reorder_quantity::text,
          is_active,
          updated_at::text
        FROM inventory_items
        WHERE is_active = TRUE AND stock_on_hand < minimum_stock_level
        ORDER BY (minimum_stock_level - stock_on_hand) DESC, name ASC
        LIMIT 30
      `
    ),
    pool.query<NeedRow>(
      `
        SELECT
          n.id,
          n.need_code,
          n.category,
          n.need_name,
          n.description,
          n.quantity_needed::text,
          n.quantity_fulfilled::text,
          n.priority,
          n.required_by::text,
          n.estimated_cost::text,
          n.justification,
          n.status,
          n.funding_status,
          n.funding_source_id::text,
          fs.name AS funding_source_name,
          n.owner_name,
          n.inventory_item_id::text,
          ii.name AS inventory_item_name,
          n.created_by,
          n.updated_at::text
        FROM club_needs n
        LEFT JOIN inventory_items ii ON ii.id = n.inventory_item_id
        LEFT JOIN funding_sources fs ON fs.id = n.funding_source_id
        WHERE n.status IN ('open', 'approved', 'sourced', 'ordered')
        ORDER BY
          CASE n.priority
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            ELSE 4
          END,
          n.required_by NULLS LAST
        LIMIT 20
      `
    )
  ]);

  const metrics = metricsResult.rows[0];

  return {
    metrics: {
      lowStockItems: metrics?.low_stock_items ?? 0,
      openNeeds: metrics?.open_needs ?? 0,
      procurementPipeline: metrics?.procurement_pipeline ?? 0,
      pendingStaffPayments: metrics?.pending_staff_payments ?? 0,
      salaryOutstanding: Number(metrics?.salary_outstanding ?? 0),
      needsBudgetOpen: Number(metrics?.needs_budget_open ?? 0)
    },
    lowStockItems: lowStockResult.rows.map((row) => {
      const mapped = mapInventoryItem(row);
      return {
        id: mapped.id,
        itemCode: mapped.itemCode,
        name: mapped.name,
        category: mapped.category,
        stockOnHand: mapped.stockOnHand,
        minimumStockLevel: mapped.minimumStockLevel,
        targetStockLevel: mapped.targetStockLevel,
        recommendedOrderQty:
          mapped.reorderQuantity > 0
            ? mapped.reorderQuantity
            : Math.max(mapped.targetStockLevel || mapped.minimumStockLevel, mapped.minimumStockLevel) -
              mapped.stockOnHand
      };
    }),
    criticalNeeds: criticalNeedsResult.rows.map(mapNeed)
  };
}

export async function listInventoryItems(limit = 200): Promise<ReturnType<typeof mapInventoryItem>[]> {
  await ensureOperationsInfrastructure();
  const result = await pool.query<InventoryItemRow>(
    `
      SELECT
        id,
        item_code,
        name,
        category,
        description,
        unit,
        stock_on_hand::text,
        minimum_stock_level::text,
        target_stock_level::text,
        reorder_quantity::text,
        is_active,
        updated_at::text
      FROM inventory_items
      ORDER BY name ASC
      LIMIT $1
    `,
    [normalizedLimit(limit)]
  );
  return result.rows.map(mapInventoryItem);
}

export async function createInventoryItem(
  input: CreateInventoryItemInput
): Promise<{ id: string; itemCode: string; name: string }> {
  await ensureOperationsInfrastructure();
  const itemCode = cleanOptional(input.itemCode) ?? makeCode('ITEM');
  const result = await pool.query<{ id: string; item_code: string; name: string }>(
    `
      INSERT INTO inventory_items (
        item_code,
        name,
        category,
        description,
        unit,
        stock_on_hand,
        minimum_stock_level,
        target_stock_level,
        reorder_quantity
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, item_code, name
    `,
    [
      itemCode,
      input.name,
      input.category,
      cleanOptional(input.description),
      input.unit,
      input.stockOnHand,
      input.minimumStockLevel,
      input.targetStockLevel,
      input.reorderQuantity
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(500, 'Failed to create inventory item');
  }
  return {
    id: row.id,
    itemCode: row.item_code,
    name: row.name
  };
}

export async function recordStockMovement(
  input: RecordStockMovementInput
): Promise<{ movementId: string; inventoryItemId: string; newStockOnHand: number }> {
  await ensureOperationsInfrastructure();
  return withTransaction(async (client) => {
    const itemResult = await client.query<{ id: string; stock_on_hand: string }>(
      `
        SELECT id, stock_on_hand::text
        FROM inventory_items
        WHERE id = $1
        LIMIT 1
      `,
      [input.inventoryItemId]
    );
    const item = itemResult.rows[0];
    if (!item) {
      throw new HttpError(404, 'Inventory item not found');
    }

    const current = Number(item.stock_on_hand);
    let delta = input.quantity;
    if (input.movementType === 'out') {
      delta = -input.quantity;
    }
    if (input.movementType === 'adjustment') {
      delta = input.quantity;
    }

    const nextStock = Number((current + delta).toFixed(2));
    if (nextStock < 0) {
      throw new HttpError(400, 'Stock cannot go below zero');
    }

    const movementResult = await client.query<{ id: string }>(
      `
        INSERT INTO stock_movements (
          inventory_item_id,
          movement_type,
          quantity,
          unit_cost,
          total_cost,
          movement_date,
          reference_type,
          reference_id,
          notes,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10)
        RETURNING id
      `,
      [
        input.inventoryItemId,
        input.movementType,
        input.quantity,
        input.unitCost ?? null,
        input.unitCost ? Number((input.quantity * input.unitCost).toFixed(2)) : null,
        input.movementDate ?? null,
        cleanOptional(input.referenceType),
        cleanOptional(input.referenceId),
        cleanOptional(input.notes),
        cleanOptional(input.createdBy)
      ]
    );

    await client.query(
      `
        UPDATE inventory_items
        SET stock_on_hand = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [input.inventoryItemId, nextStock]
    );

    const row = movementResult.rows[0];
    if (!row) {
      throw new HttpError(500, 'Failed to record stock movement');
    }
    return {
      movementId: row.id,
      inventoryItemId: input.inventoryItemId,
      newStockOnHand: nextStock
    };
  });
}

export async function autoCreateNeedsFromStockGaps(actor: string | undefined): Promise<{
  created: number;
  skipped: number;
}> {
  await ensureOperationsInfrastructure();
  const createdBy = nowActor(actor);

  return withTransaction(async (client) => {
    const candidates = await client.query<
      InventoryItemRow & { existing_open_need_count: number; suggested_gap: string; suggested_priority: string }
    >(
      `
        SELECT
          ii.id,
          ii.item_code,
          ii.name,
          ii.category,
          ii.description,
          ii.unit,
          ii.stock_on_hand::text,
          ii.minimum_stock_level::text,
          ii.target_stock_level::text,
          ii.reorder_quantity::text,
          ii.is_active,
          ii.updated_at::text,
          COALESCE(n.open_need_count, 0) AS existing_open_need_count,
          GREATEST(COALESCE(NULLIF(ii.target_stock_level, 0), ii.minimum_stock_level) - ii.stock_on_hand, 0)::text AS suggested_gap,
          CASE
            WHEN ii.stock_on_hand <= 0 THEN 'critical'
            WHEN ii.stock_on_hand < ii.minimum_stock_level THEN 'high'
            ELSE 'medium'
          END AS suggested_priority
        FROM inventory_items ii
        LEFT JOIN (
          SELECT inventory_item_id, COUNT(*)::int AS open_need_count
          FROM club_needs
          WHERE status IN ('open', 'approved', 'sourced', 'ordered')
          GROUP BY inventory_item_id
        ) n ON n.inventory_item_id = ii.id
        WHERE ii.is_active = TRUE AND ii.stock_on_hand < ii.minimum_stock_level
        ORDER BY (ii.minimum_stock_level - ii.stock_on_hand) DESC
      `
    );

    let created = 0;
    let skipped = 0;
    for (const item of candidates.rows) {
      if ((item.existing_open_need_count ?? 0) > 0) {
        skipped += 1;
        continue;
      }
      const suggestedGap = Number(item.suggested_gap);
      if (suggestedGap <= 0) {
        skipped += 1;
        continue;
      }
      await client.query(
        `
          INSERT INTO club_needs (
            need_code,
            category,
            need_name,
            description,
            quantity_needed,
            quantity_fulfilled,
            priority,
            estimated_cost,
            justification,
            status,
            funding_status,
            owner_name,
            inventory_item_id,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, 0, $6, 0, $7, 'open', 'unfunded', 'Logistics', $8, $9)
        `,
        [
          makeCode('NEED'),
          item.category,
          item.name,
          cleanOptional(item.description),
          suggestedGap,
          item.suggested_priority,
          `Auto-created from stock gap: on hand ${item.stock_on_hand}, minimum ${item.minimum_stock_level}, target ${item.target_stock_level}.`,
          item.id,
          createdBy
        ]
      );
      created += 1;
    }
    return { created, skipped };
  });
}

export async function listNeeds(
  status: 'all' | 'open' | 'approved' | 'sourced' | 'ordered' | 'received' | 'closed',
  limit = 200
): Promise<ReturnType<typeof mapNeed>[]> {
  await ensureOperationsInfrastructure();
  const params: unknown[] = [normalizedLimit(limit)];
  let statusClause = '';
  if (status !== 'all') {
    params.push(status);
    statusClause = 'AND n.status = $2';
  }

  const result = await pool.query<NeedRow>(
    `
      SELECT
        n.id,
        n.need_code,
        n.category,
        n.need_name,
        n.description,
        n.quantity_needed::text,
        n.quantity_fulfilled::text,
        n.priority,
        n.required_by::text,
        n.estimated_cost::text,
        n.justification,
        n.status,
        n.funding_status,
        n.funding_source_id::text,
        fs.name AS funding_source_name,
        n.owner_name,
        n.inventory_item_id::text,
        ii.name AS inventory_item_name,
        n.created_by,
        n.updated_at::text
      FROM club_needs n
      LEFT JOIN inventory_items ii ON ii.id = n.inventory_item_id
      LEFT JOIN funding_sources fs ON fs.id = n.funding_source_id
      WHERE 1=1
      ${statusClause}
      ORDER BY
        CASE n.priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        n.required_by NULLS LAST,
        n.created_at DESC
      LIMIT $1
    `,
    params
  );
  return result.rows.map(mapNeed);
}

export async function createNeed(input: CreateNeedInput): Promise<{ id: string; needCode: string }> {
  await ensureOperationsInfrastructure();
  const created = await pool.query<{ id: string; need_code: string }>(
    `
      INSERT INTO club_needs (
        need_code,
        category,
        need_name,
        description,
        quantity_needed,
        quantity_fulfilled,
        priority,
        required_by,
        estimated_cost,
        justification,
        status,
        funding_status,
        funding_source_id,
        owner_name,
        inventory_item_id,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id, need_code
    `,
    [
      makeCode('NEED'),
      input.category,
      input.needName,
      cleanOptional(input.description),
      input.quantityNeeded,
      input.priority,
      input.requiredBy ?? null,
      input.estimatedCost,
      cleanOptional(input.justification),
      input.status,
      input.fundingStatus,
      input.fundingSourceId ?? null,
      cleanOptional(input.ownerName),
      input.inventoryItemId ?? null,
      nowActor(input.createdBy)
    ]
  );
  const row = created.rows[0];
  if (!row) {
    throw new HttpError(500, 'Failed to create need');
  }
  return {
    id: row.id,
    needCode: row.need_code
  };
}

export async function updateNeed(needId: string, input: UpdateNeedInput): Promise<void> {
  await ensureOperationsInfrastructure();
  const fields: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (input.category !== undefined) assign('category', input.category);
  if (input.needName !== undefined) assign('need_name', input.needName);
  if (input.description !== undefined) assign('description', cleanOptional(input.description) ?? null);
  if (input.quantityNeeded !== undefined) assign('quantity_needed', input.quantityNeeded);
  if (input.quantityFulfilled !== undefined) assign('quantity_fulfilled', input.quantityFulfilled);
  if (input.priority !== undefined) assign('priority', input.priority);
  if (input.requiredBy !== undefined) assign('required_by', input.requiredBy ?? null);
  if (input.estimatedCost !== undefined) assign('estimated_cost', input.estimatedCost);
  if (input.justification !== undefined) assign('justification', cleanOptional(input.justification) ?? null);
  if (input.status !== undefined) assign('status', input.status);
  if (input.fundingStatus !== undefined) assign('funding_status', input.fundingStatus);
  if (input.fundingSourceId !== undefined) assign('funding_source_id', input.fundingSourceId ?? null);
  if (input.ownerName !== undefined) assign('owner_name', cleanOptional(input.ownerName) ?? null);
  if (input.inventoryItemId !== undefined) assign('inventory_item_id', input.inventoryItemId ?? null);

  fields.push('updated_at = NOW()');
  values.push(needId);
  const result = await pool.query(
    `
      UPDATE club_needs
      SET ${fields.join(', ')}
      WHERE id = $${values.length}
    `,
    values
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new HttpError(404, 'Need not found');
  }
}

export async function listProcurementRequests(
  status: 'all' | 'draft' | 'submitted' | 'approved' | 'ordered' | 'delivered' | 'closed' | 'cancelled',
  limit = 200
): Promise<
  Array<{
    id: string;
    prNumber: string;
    title: string;
    requestedBy: string | null;
    approvedBy: string | null;
    supplierName: string | null;
    quoteReference: string | null;
    budgetLine: string | null;
    fundingSourceId: string | null;
    fundingSourceName: string | null;
    expectedDeliveryDate: string | null;
    totalEstimatedAmount: number;
    status: string;
    notes: string | null;
    needCodes: string[];
    createdAt: string;
    updatedAt: string;
  }>
> {
  await ensureOperationsInfrastructure();
  const params: unknown[] = [normalizedLimit(limit)];
  let statusClause = '';
  if (status !== 'all') {
    params.push(status);
    statusClause = 'AND pr.status = $2';
  }
  const result = await pool.query<ProcurementRow>(
    `
      SELECT
        pr.id,
        pr.pr_number,
        pr.title,
        pr.requested_by,
        pr.approved_by,
        pr.supplier_name,
        pr.quote_reference,
        pr.budget_line,
        pr.funding_source_id::text,
        fs.name AS funding_source_name,
        pr.expected_delivery_date::text,
        pr.total_estimated_amount::text,
        pr.status,
        pr.notes,
        COALESCE(string_agg(n.need_code, '||' ORDER BY n.need_code), '') AS need_codes,
        pr.created_at::text,
        pr.updated_at::text
      FROM procurement_requests pr
      LEFT JOIN procurement_request_needs prn ON prn.procurement_request_id = pr.id
      LEFT JOIN club_needs n ON n.id = prn.need_id
      LEFT JOIN funding_sources fs ON fs.id = pr.funding_source_id
      WHERE 1=1
      ${statusClause}
      GROUP BY pr.id, fs.name
      ORDER BY pr.created_at DESC
      LIMIT $1
    `,
    params
  );

  return result.rows.map((row) => ({
    id: row.id,
    prNumber: row.pr_number,
    title: row.title,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    supplierName: row.supplier_name,
    quoteReference: row.quote_reference,
    budgetLine: row.budget_line,
    fundingSourceId: row.funding_source_id,
    fundingSourceName: row.funding_source_name,
    expectedDeliveryDate: row.expected_delivery_date,
    totalEstimatedAmount: Number(row.total_estimated_amount),
    status: row.status,
    notes: row.notes,
    needCodes: row.need_codes ? row.need_codes.split('||').filter((item) => item) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function createProcurementRequest(
  input: CreateProcurementRequestInput
): Promise<{ id: string; prNumber: string }> {
  await ensureOperationsInfrastructure();
  return withTransaction(async (client) => {
    if (input.needIds.length > 0) {
      const needsResult = await client.query<{ id: string }>(
        `SELECT id FROM club_needs WHERE id = ANY($1::uuid[])`,
        [input.needIds]
      );
      if (needsResult.rows.length !== input.needIds.length) {
        throw new HttpError(400, 'One or more linked needs were not found');
      }
    }

    const created = await client.query<{ id: string; pr_number: string }>(
      `
        INSERT INTO procurement_requests (
          pr_number,
          title,
          requested_by,
          approved_by,
          supplier_name,
          quote_reference,
          budget_line,
          funding_source_id,
          expected_delivery_date,
          total_estimated_amount,
          status,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, pr_number
      `,
      [
        makeCode('PR'),
        input.title,
        cleanOptional(input.requestedBy),
        cleanOptional(input.approvedBy),
        cleanOptional(input.supplierName),
        cleanOptional(input.quoteReference),
        cleanOptional(input.budgetLine),
        input.fundingSourceId ?? null,
        input.expectedDeliveryDate ?? null,
        input.totalEstimatedAmount,
        input.status,
        cleanOptional(input.notes)
      ]
    );

    const row = created.rows[0];
    if (!row) {
      throw new HttpError(500, 'Failed to create procurement request');
    }

    for (const needId of input.needIds) {
      await client.query(
        `
          INSERT INTO procurement_request_needs (procurement_request_id, need_id)
          VALUES ($1, $2)
          ON CONFLICT (procurement_request_id, need_id) DO NOTHING
        `,
        [row.id, needId]
      );
    }

    if (input.needIds.length > 0) {
      const linkedStatus = input.status === 'ordered' ? 'ordered' : 'sourced';
      await client.query(
        `
          UPDATE club_needs
          SET status = $2, updated_at = NOW()
          WHERE id = ANY($1::uuid[]) AND status IN ('open', 'approved', 'sourced')
        `,
        [input.needIds, linkedStatus]
      );
    }

    return {
      id: row.id,
      prNumber: row.pr_number
    };
  });
}

export async function receiveProcurementRequest(
  requestId: string,
  input: ReceiveProcurementRequestInput
): Promise<{ requestId: string; stockMovements: number; needsClosed: number }> {
  await ensureOperationsInfrastructure();
  return withTransaction(async (client) => {
    const requestResult = await client.query<{ id: string; status: string }>(
      `
        SELECT id, status
        FROM procurement_requests
        WHERE id = $1
        LIMIT 1
      `,
      [requestId]
    );
    if (!requestResult.rows[0]) {
      throw new HttpError(404, 'Procurement request not found');
    }

    const linkedNeeds = await client.query<
      Pick<NeedRow, 'id' | 'inventory_item_id' | 'quantity_needed' | 'quantity_fulfilled' | 'status'>
    >(
      `
        SELECT
          n.id,
          n.inventory_item_id::text,
          n.quantity_needed::text,
          n.quantity_fulfilled::text,
          n.status
        FROM procurement_request_needs prn
        INNER JOIN club_needs n ON n.id = prn.need_id
        WHERE prn.procurement_request_id = $1
      `,
      [requestId]
    );

    let stockMovements = 0;
    let needsClosed = 0;
    for (const need of linkedNeeds.rows) {
      const quantityNeeded = Number(need.quantity_needed);
      const quantityFulfilled = Number(need.quantity_fulfilled);
      const remaining = Math.max(quantityNeeded - quantityFulfilled, 0);

      if (need.inventory_item_id && remaining > 0) {
        const inventory = await client.query<{ stock_on_hand: string }>(
          `
            SELECT stock_on_hand::text
            FROM inventory_items
            WHERE id = $1
            LIMIT 1
          `,
          [need.inventory_item_id]
        );
        if (inventory.rows[0]) {
          const nextStock = Number(inventory.rows[0].stock_on_hand) + remaining;
          await client.query(
            `
              UPDATE inventory_items
              SET stock_on_hand = $2, updated_at = NOW()
              WHERE id = $1
            `,
            [need.inventory_item_id, nextStock]
          );

          await client.query(
            `
              INSERT INTO stock_movements (
                inventory_item_id,
                movement_type,
                quantity,
                movement_date,
                reference_type,
                reference_id,
                notes,
                created_by
              )
              VALUES ($1, 'in', $2, COALESCE($3::date, CURRENT_DATE), 'procurement', $4, $5, $6)
            `,
            [
              need.inventory_item_id,
              remaining,
              input.movementDate ?? null,
              requestId,
              cleanOptional(input.notes) ?? 'Received from procurement request',
              nowActor(input.createdBy)
            ]
          );
          stockMovements += 1;
        }
      }

      await client.query(
        `
          UPDATE club_needs
          SET
            quantity_fulfilled = quantity_needed,
            status = 'closed',
            updated_at = NOW()
          WHERE id = $1
        `,
        [need.id]
      );
      needsClosed += 1;
    }

    await client.query(
      `
        UPDATE procurement_requests
        SET status = 'delivered', updated_at = NOW()
        WHERE id = $1
      `,
      [requestId]
    );

    return {
      requestId,
      stockMovements,
      needsClosed
    };
  });
}

export async function listFundingSources(
  limit = 200
): Promise<
  Array<{
    id: string;
    sourceCode: string;
    name: string;
    sourceType: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    committedAmount: number;
    receivedAmount: number;
    currency: string;
    balanceToReceive: number;
    notes: string | null;
    isActive: boolean;
    updatedAt: string;
  }>
> {
  await ensureOperationsInfrastructure();
  const result = await pool.query<FundingSourceRow>(
    `
      SELECT
        id,
        source_code,
        name,
        source_type,
        contact_name,
        phone,
        email,
        committed_amount::text,
        received_amount::text,
        currency,
        notes,
        is_active,
        updated_at::text
      FROM funding_sources
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [normalizedLimit(limit)]
  );
  return result.rows.map((row) => {
    const committed = Number(row.committed_amount);
    const received = Number(row.received_amount);
    return {
      id: row.id,
      sourceCode: row.source_code,
      name: row.name,
      sourceType: row.source_type,
      contactName: row.contact_name,
      phone: row.phone,
      email: row.email,
      committedAmount: committed,
      receivedAmount: received,
      currency: row.currency,
      balanceToReceive: Math.max(committed - received, 0),
      notes: row.notes,
      isActive: row.is_active,
      updatedAt: row.updated_at
    };
  });
}

export async function createFundingSource(
  input: CreateFundingSourceInput
): Promise<{ id: string; sourceCode: string }> {
  await ensureOperationsInfrastructure();
  const actor = 'admin';
  const sourceCode = cleanOptional(input.sourceCode) ?? makeCode('FUND');
  const created = await withTransaction(async (client) => {
    const result = await client.query<{ id: string; source_code: string; currency: string }>(
      `
        INSERT INTO funding_sources (
          source_code,
          name,
          source_type,
          contact_name,
          phone,
          email,
          committed_amount,
          received_amount,
          currency,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, source_code, currency
      `,
      [
        sourceCode,
        input.name,
        input.sourceType,
        cleanOptional(input.contactName),
        cleanOptional(input.phone),
        cleanOptional(input.email),
        input.committedAmount,
        input.receivedAmount,
        input.currency.toUpperCase(),
        cleanOptional(input.notes)
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new HttpError(500, 'Failed to create funding source');
    }

    if (input.receivedAmount > 0) {
      await client.query(
        `
          INSERT INTO funding_receipts (
            funding_source_id,
            received_amount,
            currency,
            received_on,
            reference,
            notes,
            recorded_by
          )
          VALUES ($1, $2, $3, CURRENT_DATE, 'INITIAL-SETUP', $4, $5)
        `,
        [
          row.id,
          input.receivedAmount,
          row.currency,
          cleanOptional(input.notes) ?? 'Initial amount captured when source was created',
          actor
        ]
      );
    }

    return {
      id: row.id,
      sourceCode: row.source_code
    };
  });

  await safeAppendAudit(actor, 'operations.funding_source.created', 'operations.funding', {
    sourceId: created.id,
    sourceCode: created.sourceCode,
    sourceType: input.sourceType,
    committedAmount: input.committedAmount,
    receivedAmount: input.receivedAmount
  });

  return created;
}

export async function receiveFunding(
  sourceId: string,
  input: ReceiveFundingInput
): Promise<{ sourceId: string; receivedAmount: number; receiptId: string; receiptDate: string }> {
  await ensureOperationsInfrastructure();
  const actor = nowActor(input.recordedBy);
  const receiptDate = input.receivedOn ?? dayjs().format('YYYY-MM-DD');
  const result = await withTransaction(async (client) => {
    const updated = await client.query<{ id: string; received_amount: string; currency: string }>(
      `
        UPDATE funding_sources
        SET
          received_amount = received_amount + $2,
          notes = CASE
            WHEN $3::text IS NULL OR TRIM($3::text) = '' THEN notes
            WHEN notes IS NULL OR notes = '' THEN $3
            ELSE notes || E'\n' || $3
          END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, received_amount::text, currency
      `,
      [sourceId, input.amount, cleanOptional(input.notes)]
    );
    const row = updated.rows[0];
    if (!row) {
      throw new HttpError(404, 'Funding source not found');
    }

    const receipt = await client.query<FundingReceiptRow>(
      `
        INSERT INTO funding_receipts (
          funding_source_id,
          received_amount,
          currency,
          received_on,
          reference,
          proof_url,
          notes,
          recorded_by
        )
        VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8)
        RETURNING id, received_amount::text, received_on::text
      `,
      [
        sourceId,
        input.amount,
        row.currency,
        input.receivedOn ?? null,
        cleanOptional(input.reference),
        cleanOptional(input.proofUrl),
        cleanOptional(input.notes),
        actor
      ]
    );

    const receiptRow = receipt.rows[0];
    if (!receiptRow) {
      throw new HttpError(500, 'Failed to record funding receipt');
    }

    return {
      sourceId: row.id,
      receivedAmount: Number(row.received_amount),
      receiptId: receiptRow.id,
      receiptDate: receiptRow.received_on
    };
  });

  await safeAppendAudit(actor, 'operations.funding.receipt_recorded', 'operations.funding', {
    sourceId: result.sourceId,
    receiptId: result.receiptId,
    amount: input.amount,
    receiptDate,
    reference: cleanOptional(input.reference),
    hasProof: Boolean(cleanOptional(input.proofUrl))
  });

  return result;
}

export async function listStaffMembers(
  limit = 200
): Promise<
  Array<{
    id: string;
    staffCode: string;
    fullName: string;
    roleTitle: string;
    rateType: string;
    rateAmount: number;
    paymentMethod: string;
    contractStart: string | null;
    contractEnd: string | null;
    isActive: boolean;
    notes: string | null;
    updatedAt: string;
  }>
> {
  await ensureOperationsInfrastructure();
  const result = await pool.query<StaffMemberRow>(
    `
      SELECT
        id,
        staff_code,
        full_name,
        role_title,
        rate_type,
        rate_amount::text,
        payment_method,
        contract_start::text,
        contract_end::text,
        is_active,
        notes,
        updated_at::text
      FROM staff_members
      ORDER BY full_name ASC
      LIMIT $1
    `,
    [normalizedLimit(limit)]
  );
  return result.rows.map((row) => ({
    id: row.id,
    staffCode: row.staff_code,
    fullName: row.full_name,
    roleTitle: row.role_title,
    rateType: row.rate_type,
    rateAmount: Number(row.rate_amount),
    paymentMethod: row.payment_method,
    contractStart: row.contract_start,
    contractEnd: row.contract_end,
    isActive: row.is_active,
    notes: row.notes,
    updatedAt: row.updated_at
  }));
}

export async function createStaffMember(input: CreateStaffMemberInput): Promise<{ id: string; staffCode: string }> {
  await ensureOperationsInfrastructure();
  const staffCode = cleanOptional(input.staffCode) ?? makeCode('STF');
  const result = await pool.query<{ id: string; staff_code: string }>(
    `
      INSERT INTO staff_members (
        staff_code,
        full_name,
        role_title,
        rate_type,
        rate_amount,
        payment_method,
        contract_start,
        contract_end,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, staff_code
    `,
    [
      staffCode,
      input.fullName,
      input.roleTitle,
      input.rateType,
      input.rateAmount,
      input.paymentMethod,
      input.contractStart ?? null,
      input.contractEnd ?? null,
      cleanOptional(input.notes)
    ]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(500, 'Failed to create staff member');
  }
  return {
    id: row.id,
    staffCode: row.staff_code
  };
}

export async function listStaffPayments(
  filters: { periodMonth?: string; status: 'all' | 'pending' | 'part_paid' | 'paid'; limit: number }
): Promise<
  Array<{
    id: string;
    staffMemberId: string;
    staffCode: string;
    fullName: string;
    roleTitle: string;
    periodMonth: string;
    amountDue: number;
    amountPaid: number;
    outstandingAmount: number;
    currency: string;
    paymentDate: string | null;
    paymentReference: string | null;
    proofUrl: string | null;
    fundingSourceId: string | null;
    fundingSourceName: string | null;
    status: string;
    notes: string | null;
    createdBy: string | null;
    updatedAt: string;
  }>
> {
  await ensureOperationsInfrastructure();

  const params: unknown[] = [normalizedLimit(filters.limit)];
  const where: string[] = [];
  if (filters.periodMonth) {
    params.push(filters.periodMonth);
    where.push(`sp.period_month = $${params.length}`);
  }
  if (filters.status !== 'all') {
    params.push(filters.status);
    where.push(`sp.status = $${params.length}`);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await pool.query<StaffPaymentRow>(
    `
      SELECT
        sp.id,
        sp.staff_member_id::text,
        sm.staff_code,
        sm.full_name,
        sm.role_title,
        sp.period_month,
        sp.amount_due::text,
        sp.amount_paid::text,
        sp.currency,
        sp.payment_date::text,
        sp.payment_reference,
        sp.proof_url,
        sp.funding_source_id::text,
        fs.name AS funding_source_name,
        sp.status,
        sp.notes,
        sp.created_by,
        sp.updated_at::text
      FROM staff_payments sp
      INNER JOIN staff_members sm ON sm.id = sp.staff_member_id
      LEFT JOIN funding_sources fs ON fs.id = sp.funding_source_id
      ${whereClause}
      ORDER BY sp.period_month DESC, sm.full_name ASC
      LIMIT $1
    `,
    params
  );

  return result.rows.map((row) => {
    const due = Number(row.amount_due);
    const paid = Number(row.amount_paid);
    return {
      id: row.id,
      staffMemberId: row.staff_member_id,
      staffCode: row.staff_code,
      fullName: row.full_name,
      roleTitle: row.role_title,
      periodMonth: row.period_month,
      amountDue: due,
      amountPaid: paid,
      outstandingAmount: Math.max(due - paid, 0),
      currency: row.currency,
      paymentDate: row.payment_date,
      paymentReference: row.payment_reference,
      proofUrl: row.proof_url,
      fundingSourceId: row.funding_source_id,
      fundingSourceName: row.funding_source_name,
      status: row.status,
      notes: row.notes,
      createdBy: row.created_by,
      updatedAt: row.updated_at
    };
  });
}

export async function getStaffPaymentSlipPdfBuffer(paymentId: string): Promise<Buffer> {
  await ensureOperationsInfrastructure();

  const result = await pool.query<StaffPaymentSlipRow>(
    `
      SELECT
        sp.id,
        sp.period_month,
        sp.amount_due::text,
        sp.amount_paid::text,
        sp.currency,
        sp.payment_date::text,
        sp.payment_reference,
        sp.status,
        sm.staff_code,
        sm.full_name,
        sm.role_title,
        sm.payment_method,
        fs.name AS funding_source_name
      FROM staff_payments sp
      INNER JOIN staff_members sm ON sm.id = sp.staff_member_id
      LEFT JOIN funding_sources fs ON fs.id = sp.funding_source_id
      WHERE sp.id = $1
      LIMIT 1
    `,
    [paymentId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, 'Salary slip source payment was not found');
  }

  const amountDue = Number(row.amount_due);
  const amountPaid = Number(row.amount_paid);
  const outstandingAmount = Math.max(amountDue - amountPaid, 0);
  const academy = await getAcademyProfileSettings();

  return buildSalarySlipPdf({
    academyName: academy.academyName,
    academyTagline: academy.tagline,
    slipNumber: `SLP-${row.id.slice(0, 8).toUpperCase()}`,
    generatedOn: dayjs().format('YYYY-MM-DD'),
    payrollPeriod: row.period_month,
    status: row.status,
    staffCode: row.staff_code,
    staffName: row.full_name,
    roleTitle: row.role_title,
    paymentMethod: row.payment_method,
    paymentDate: row.payment_date,
    paymentReference: row.payment_reference,
    fundingSourceName: row.funding_source_name,
    amountDue,
    amountPaid,
    outstandingAmount,
    currency: row.currency,
    issuedBy: `${academy.academyName} MIS`,
    contactEmail: academy.contactEmail,
    contactPhone: academy.contactPhone
  });
}

export async function createStaffPayment(input: CreateStaffPaymentInput): Promise<{ id: string; status: string }> {
  await ensureOperationsInfrastructure();
  const status = computeStaffPaymentStatus(input.amountDue, input.amountPaid);
  const created = await pool.query<{ id: string; status: string }>(
    `
      INSERT INTO staff_payments (
        staff_member_id,
        period_month,
        amount_due,
        amount_paid,
        currency,
        payment_date,
        payment_reference,
        proof_url,
        funding_source_id,
        status,
        notes,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (staff_member_id, period_month)
      DO UPDATE SET
        amount_due = EXCLUDED.amount_due,
        amount_paid = EXCLUDED.amount_paid,
        currency = EXCLUDED.currency,
        payment_date = EXCLUDED.payment_date,
        payment_reference = EXCLUDED.payment_reference,
        proof_url = EXCLUDED.proof_url,
        funding_source_id = EXCLUDED.funding_source_id,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        created_by = EXCLUDED.created_by,
        updated_at = NOW()
      RETURNING id, status
    `,
    [
      input.staffMemberId,
      input.periodMonth,
      input.amountDue,
      input.amountPaid,
      input.currency.toUpperCase(),
      input.paymentDate ?? null,
      cleanOptional(input.paymentReference),
      cleanOptional(input.proofUrl),
      input.fundingSourceId ?? null,
      status,
      cleanOptional(input.notes),
      nowActor(input.createdBy)
    ]
  );
  const row = created.rows[0];
  if (!row) {
    throw new HttpError(500, 'Failed to create staff payment');
  }
  return {
    id: row.id,
    status: row.status
  };
}

export async function recordStaffPayment(
  paymentId: string,
  input: RecordStaffPaymentInput
): Promise<{ paymentId: string; amountPaid: number; status: string }> {
  await ensureOperationsInfrastructure();
  return withTransaction(async (client) => {
    const currentResult = await client.query<{ amount_due: string; amount_paid: string }>(
      `
        SELECT amount_due::text, amount_paid::text
        FROM staff_payments
        WHERE id = $1
        LIMIT 1
      `,
      [paymentId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      throw new HttpError(404, 'Staff payment entry not found');
    }
    const amountDue = Number(current.amount_due);
    const amountPaid = Number(current.amount_paid) + input.amount;
    const status = computeStaffPaymentStatus(amountDue, amountPaid);

    const updated = await client.query<{ id: string; amount_paid: string; status: string }>(
      `
        UPDATE staff_payments
        SET
          amount_paid = $2,
          payment_date = COALESCE($3::date, payment_date, CURRENT_DATE),
          payment_reference = COALESCE($4, payment_reference),
          proof_url = COALESCE($5, proof_url),
          notes = CASE
            WHEN $6::text IS NULL OR TRIM($6::text) = '' THEN notes
            WHEN notes IS NULL OR notes = '' THEN $6
            ELSE notes || E'\n' || $6
          END,
          status = $7,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, amount_paid::text, status
      `,
      [
        paymentId,
        amountPaid,
        input.paymentDate ?? null,
        cleanOptional(input.paymentReference),
        cleanOptional(input.proofUrl),
        cleanOptional(input.notes),
        status
      ]
    );
    const row = updated.rows[0];
    if (!row) {
      throw new HttpError(500, 'Failed to update staff payment');
    }
    return {
      paymentId: row.id,
      amountPaid: Number(row.amount_paid),
      status: row.status
    };
  });
}
