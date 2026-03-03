import { z } from 'zod';

const optionalUrlInput = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional()
);

export const UpdateAcademyProfileSchema = z.object({
  academyName: z.string().min(2),
  divisionLine: z.string().min(2),
  tagline: z.string().min(2),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(6),
  addressLine: z.string().min(2),
  currency: z.string().length(3),
  timezone: z.string().min(2),
  bankName: z.string().min(2),
  bankAccountName: z.string().min(2),
  bankAccountNumber: z.string().min(2)
});

export const UpdateBillingDefaultsSchema = z.object({
  registrationFee: z.coerce.number().positive(),
  monthlyFee: z.coerce.number().positive(),
  dueDayOfMonth: z.coerce.number().int().min(1).max(28),
  invoiceGraceDays: z.coerce.number().int().min(1).max(60),
  defaultCurrency: z.string().length(3)
});

export const UpdateReminderDefaultsSchema = z.object({
  beforeDueDays: z.coerce.number().int().min(0).max(30),
  overdueDays: z.coerce.number().int().min(1).max(30),
  enableEmail: z.boolean(),
  enableWhatsApp: z.boolean()
});

export const UpdateChannelsSchema = z.object({
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  emailFrom: z.string().email().optional(),
  smtpSimulate: z.boolean().optional(),
  whatsappApiUrl: optionalUrlInput,
  whatsappApiToken: z.string().optional(),
  whatsappDefaultSender: z.string().optional(),
  whatsappSimulate: z.boolean().optional()
});

export const TestEmailSchema = z.object({
  toEmail: z.string().email()
});

export const TestWhatsAppSchema = z.object({
  toPhone: z.string().min(6),
  message: z.string().min(3).max(1200).optional()
});

export const ListAuditSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export type UpdateAcademyProfileInput = z.infer<typeof UpdateAcademyProfileSchema>;
export type UpdateBillingDefaultsInput = z.infer<typeof UpdateBillingDefaultsSchema>;
export type UpdateReminderDefaultsInput = z.infer<typeof UpdateReminderDefaultsSchema>;
export type UpdateChannelsInput = z.infer<typeof UpdateChannelsSchema>;
export type TestEmailInput = z.infer<typeof TestEmailSchema>;
export type TestWhatsAppInput = z.infer<typeof TestWhatsAppSchema>;

