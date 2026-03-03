import { z } from 'zod';

export const CreateSessionSchema = z.object({
  groupCode: z.enum(['U9', 'U11', 'U13', 'U15']),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  notes: z.string().optional()
});

export const UpsertAttendanceSchema = z.object({
  records: z
    .array(
      z.object({
        playerCode: z.string().min(1),
        status: z.enum(['present', 'absent', 'late', 'excused']),
        arrivalTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        notes: z.string().optional()
      })
    )
    .min(1)
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type UpsertAttendanceInput = z.infer<typeof UpsertAttendanceSchema>;

