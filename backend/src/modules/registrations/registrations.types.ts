import { z } from 'zod';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date format YYYY-MM-DD');

export const RegistrationPayloadSchema = z.object({
  player: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dateOfBirth: IsoDate,
    gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
    idOrBirthCertNo: z.string().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    town: z.string().optional(),
    region: z.string().optional(),
    schoolName: z.string().optional(),
    schoolGrade: z.string().optional(),
    preferredPosition: z.string().optional(),
    preferredFoot: z.enum(['left', 'right', 'both', 'unknown']).default('unknown'),
    yearsOfExperience: z.coerce.number().min(0).max(50).optional(),
    previousClub: z.string().optional()
  }),
  guardian: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    relationshipToPlayer: z.string().min(1),
    phoneWhatsapp: z.string().min(1),
    alternatePhone: z.string().optional(),
    email: z.string().email().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    town: z.string().optional(),
    region: z.string().optional()
  }),
  emergencyContact: z.object({
    fullName: z.string().min(1),
    relationshipToPlayer: z.string().min(1),
    phone: z.string().min(1),
    priority: z.coerce.number().int().min(1).max(5).default(1)
  }),
  medical: z.object({
    medicalConditions: z.string().optional(),
    allergies: z.string().optional(),
    hasAsthma: z.boolean().default(false),
    injuryHistory: z.string().optional(),
    currentMedication: z.string().optional(),
    medicalAidProvider: z.string().optional(),
    medicalAidNumber: z.string().optional(),
    doctorOrClinicName: z.string().optional(),
    doctorPhone: z.string().optional(),
    emergencyTreatmentConsent: z.boolean().default(false)
  }),
  training: z.object({
    uniformSize: z.string().optional(),
    notes: z.string().optional()
  }).default({}),
  billing: z.object({
    dueDayOfMonth: z.coerce.number().int().min(1).max(28).default(5)
  }).default({
    dueDayOfMonth: 5
  }),
  consents: z.object({
    academyTerms: z.boolean(),
    mediaPermission: z.boolean(),
    dataProcessing: z.boolean()
  })
});

export type RegistrationPayload = z.infer<typeof RegistrationPayloadSchema>;
