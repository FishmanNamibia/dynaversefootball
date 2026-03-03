import { z } from 'zod';

const YearMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Expected format YYYY-MM');

export const RecordPaymentSchema = z.object({
  playerCode: z.string().min(1),
  method: z.enum(['eft', 'cash', 'card', 'mobile_money', 'other']),
  amount: z.coerce.number().positive(),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentReference: z.string().optional(),
  externalReference: z.string().optional(),
  notes: z.string().optional(),
  recordedBy: z.string().optional()
});

export const GenerateMonthlyInvoicesSchema = z.object({
  billingMonth: YearMonth.optional()
});

export const CreateCustomFeeInvoiceSchema = z.object({
  playerCode: z.string().min(1),
  feeName: z.string().min(1),
  amount: z.coerce.number().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().optional(),
  quantity: z.coerce.number().positive().default(1),
  category: z.string().default('activity_contribution')
});

export const SendInvoiceSchema = z.object({
  channel: z.enum(['email', 'whatsapp']),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  note: z.string().optional()
});

export const SendOutstandingRemindersSchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'both']).default('both'),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;
export type GenerateMonthlyInvoicesInput = z.infer<typeof GenerateMonthlyInvoicesSchema>;
export type CreateCustomFeeInvoiceInput = z.infer<typeof CreateCustomFeeInvoiceSchema>;
export type SendInvoiceInput = z.infer<typeof SendInvoiceSchema>;
export type SendOutstandingRemindersInput = z.infer<typeof SendOutstandingRemindersSchema>;
