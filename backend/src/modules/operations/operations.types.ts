import { z } from 'zod';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const YearMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Expected format YYYY-MM');

export const ListWithLimitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const ListNeedsSchema = z.object({
  status: z.enum(['all', 'open', 'approved', 'sourced', 'ordered', 'received', 'closed']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const ListProcurementSchema = z.object({
  status: z
    .enum(['all', 'draft', 'submitted', 'approved', 'ordered', 'delivered', 'closed', 'cancelled'])
    .default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const ListStaffPaymentsSchema = z.object({
  periodMonth: YearMonth.optional(),
  status: z.enum(['all', 'pending', 'part_paid', 'paid']).default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const CreateInventoryItemSchema = z.object({
  itemCode: z.string().min(2).optional(),
  name: z.string().min(2),
  category: z.enum(['equipment', 'kits', 'facilities', 'services', 'salaries', 'other']).default('equipment'),
  description: z.string().optional(),
  unit: z.string().min(1).default('units'),
  stockOnHand: z.coerce.number().min(0).default(0),
  minimumStockLevel: z.coerce.number().min(0).default(0),
  targetStockLevel: z.coerce.number().min(0).default(0),
  reorderQuantity: z.coerce.number().min(0).default(0)
});

export const RecordStockMovementSchema = z.object({
  inventoryItemId: z.string().uuid(),
  movementType: z.enum(['in', 'out', 'adjustment', 'donation']),
  quantity: z.coerce.number().nonnegative(),
  unitCost: z.coerce.number().min(0).optional(),
  movementDate: DateString.optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
  notes: z.string().optional(),
  createdBy: z.string().optional()
});

export const AutoCreateNeedsSchema = z.object({
  createdBy: z.string().optional()
});

export const CreateNeedSchema = z.object({
  category: z.enum(['equipment', 'kits', 'facilities', 'services', 'salaries', 'other']),
  needName: z.string().min(2),
  description: z.string().optional(),
  quantityNeeded: z.coerce.number().positive(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  requiredBy: DateString.optional(),
  estimatedCost: z.coerce.number().min(0).default(0),
  justification: z.string().optional(),
  status: z.enum(['open', 'approved', 'sourced', 'ordered', 'received', 'closed']).default('open'),
  fundingStatus: z.enum(['unfunded', 'partially_funded', 'fully_funded']).default('unfunded'),
  fundingSourceId: z.string().uuid().optional(),
  ownerName: z.string().optional(),
  inventoryItemId: z.string().uuid().optional(),
  createdBy: z.string().optional()
});

export const UpdateNeedSchema = z
  .object({
    category: z.enum(['equipment', 'kits', 'facilities', 'services', 'salaries', 'other']).optional(),
    needName: z.string().min(2).optional(),
    description: z.string().optional(),
    quantityNeeded: z.coerce.number().positive().optional(),
    quantityFulfilled: z.coerce.number().min(0).optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    requiredBy: DateString.optional(),
    estimatedCost: z.coerce.number().min(0).optional(),
    justification: z.string().optional(),
    status: z.enum(['open', 'approved', 'sourced', 'ordered', 'received', 'closed']).optional(),
    fundingStatus: z.enum(['unfunded', 'partially_funded', 'fully_funded']).optional(),
    fundingSourceId: z.string().uuid().optional(),
    ownerName: z.string().optional(),
    inventoryItemId: z.string().uuid().optional(),
    updatedBy: z.string().optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided'
  });

export const CreateProcurementRequestSchema = z.object({
  title: z.string().min(2),
  needIds: z.array(z.string().uuid()).default([]),
  requestedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  supplierName: z.string().optional(),
  quoteReference: z.string().optional(),
  budgetLine: z.string().optional(),
  fundingSourceId: z.string().uuid().optional(),
  expectedDeliveryDate: DateString.optional(),
  totalEstimatedAmount: z.coerce.number().min(0).default(0),
  status: z.enum(['draft', 'submitted', 'approved', 'ordered', 'delivered', 'closed', 'cancelled']).default('draft'),
  notes: z.string().optional()
});

export const ReceiveProcurementRequestSchema = z.object({
  movementDate: DateString.optional(),
  notes: z.string().optional(),
  createdBy: z.string().optional()
});

export const CreateFundingSourceSchema = z.object({
  sourceCode: z.string().min(2).optional(),
  name: z.string().min(2),
  sourceType: z.enum(['donor', 'sponsor', 'internal', 'parent_contribution', 'other']).default('donor'),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  committedAmount: z.coerce.number().min(0).default(0),
  receivedAmount: z.coerce.number().min(0).default(0),
  currency: z.string().length(3).default('NAD'),
  notes: z.string().optional()
});

export const ReceiveFundingSchema = z.object({
  amount: z.coerce.number().positive(),
  notes: z.string().optional()
});

export const CreateStaffMemberSchema = z.object({
  staffCode: z.string().min(2).optional(),
  fullName: z.string().min(2),
  roleTitle: z.string().min(2),
  rateType: z.enum(['monthly', 'session', 'hourly']),
  rateAmount: z.coerce.number().nonnegative(),
  paymentMethod: z.enum(['eft', 'cash', 'card', 'mobile_money', 'other']).default('eft'),
  contractStart: DateString.optional(),
  contractEnd: DateString.optional(),
  notes: z.string().optional()
});

export const CreateStaffPaymentSchema = z.object({
  staffMemberId: z.string().uuid(),
  periodMonth: YearMonth,
  amountDue: z.coerce.number().positive(),
  amountPaid: z.coerce.number().min(0).default(0),
  currency: z.string().length(3).default('NAD'),
  paymentDate: DateString.optional(),
  paymentReference: z.string().optional(),
  proofUrl: z.string().optional(),
  fundingSourceId: z.string().uuid().optional(),
  notes: z.string().optional(),
  createdBy: z.string().optional()
});

export const RecordStaffPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentDate: DateString.optional(),
  paymentReference: z.string().optional(),
  proofUrl: z.string().optional(),
  notes: z.string().optional()
});

export type CreateInventoryItemInput = z.infer<typeof CreateInventoryItemSchema>;
export type RecordStockMovementInput = z.infer<typeof RecordStockMovementSchema>;
export type CreateNeedInput = z.infer<typeof CreateNeedSchema>;
export type UpdateNeedInput = z.infer<typeof UpdateNeedSchema>;
export type CreateProcurementRequestInput = z.infer<typeof CreateProcurementRequestSchema>;
export type ReceiveProcurementRequestInput = z.infer<typeof ReceiveProcurementRequestSchema>;
export type CreateFundingSourceInput = z.infer<typeof CreateFundingSourceSchema>;
export type ReceiveFundingInput = z.infer<typeof ReceiveFundingSchema>;
export type CreateStaffMemberInput = z.infer<typeof CreateStaffMemberSchema>;
export type CreateStaffPaymentInput = z.infer<typeof CreateStaffPaymentSchema>;
export type RecordStaffPaymentInput = z.infer<typeof RecordStaffPaymentSchema>;
