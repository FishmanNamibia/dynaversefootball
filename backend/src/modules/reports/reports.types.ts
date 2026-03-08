import { z } from 'zod';

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected format YYYY-MM-DD');

export const FinanceTransparencyQuerySchema = z.object({
  from: DateString.optional(),
  to: DateString.optional(),
  sourceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});

export type FinanceTransparencyQueryInput = z.infer<typeof FinanceTransparencyQuerySchema>;

export const CreateManualIncomeEntrySchema = z.object({
  entryDate: DateString,
  sourceId: z.string().uuid().optional(),
  source: z.string().min(2),
  incomeType: z.enum(['fees', 'donation', 'sponsor', 'other']).default('other'),
  description: z.string().optional(),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default('NAD'),
  reference: z.string().optional(),
  proofUrl: z.string().url().optional(),
  recordedBy: z.string().optional()
});

export const CreateManualExpenseEntrySchema = z.object({
  entryDate: DateString,
  sourceId: z.string().uuid().optional(),
  category: z
    .enum(['coaching_salaries', 'equipment', 'facility', 'transport', 'administration', 'other'])
    .default('other'),
  description: z.string().min(2),
  amount: z.coerce.number().positive(),
  currency: z.string().length(3).default('NAD'),
  reference: z.string().optional(),
  proofUrl: z.string().url().optional(),
  recordedBy: z.string().optional()
});

export type CreateManualIncomeEntryInput = z.infer<typeof CreateManualIncomeEntrySchema>;
export type CreateManualExpenseEntryInput = z.infer<typeof CreateManualExpenseEntrySchema>;
