import { z } from 'zod';

export const ListPendingSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

export const DispatchDueSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

export const CollectionsDashboardSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const CollectionStatusSchema = z.enum(['all', 'overdue', 'due_this_week', 'current', 'paid']);

export const ListCollectionsAccountsSchema = z.object({
  status: CollectionStatusSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const ReminderStageSchema = z.enum(['stage_1', 'stage_2', 'stage_3', 'final', 'none']);
export const ReminderChannelSchema = z.enum(['email', 'whatsapp', 'both']);

export const SendGuardianReminderSchema = z.object({
  channel: ReminderChannelSchema.default('both'),
  stage: ReminderStageSchema.optional(),
  customMessage: z.string().min(5).max(1500).optional()
});

export const SendBulkStageRemindersSchema = z.object({
  stage: ReminderStageSchema.refine((value) => value !== 'none', {
    message: 'Bulk send requires a stage from stage_1 to final'
  }),
  channel: ReminderChannelSchema.default('both'),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const MarkGuardianContactedSchema = z.object({
  note: z.string().min(2).max(1000)
});

export type ListCollectionsAccountsInput = z.infer<typeof ListCollectionsAccountsSchema>;
export type SendGuardianReminderInput = z.infer<typeof SendGuardianReminderSchema>;
export type SendBulkStageRemindersInput = z.infer<typeof SendBulkStageRemindersSchema>;
