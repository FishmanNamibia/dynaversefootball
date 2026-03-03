import dayjs from 'dayjs';
import type { PoolClient } from 'pg';
import { withTransaction } from '../../db/tx.js';
import { HttpError } from '../../utils/httpError.js';
import { createInvoiceNumber, createPlayerCode } from '../../utils/ids.js';
import type { RegistrationPayload } from './registrations.types.js';
import { scheduleReminderEvents } from '../reminders/reminders.scheduler.js';
import {
  calculateAgeFromDateOfBirth,
  resolveTrainingGroupByAge,
  type AutoTrainingGroupCode
} from './trainingGroup.auto.js';

type FeePlanRow = {
  id: string;
  amount: string;
  currency: string;
};

export async function createRegistration(payload: RegistrationPayload): Promise<{
  playerId: string;
  playerCode: string;
  guardianId: string;
  invoiceId: string;
  invoiceNumber: string;
  assignedTrainingGroup: AutoTrainingGroupCode;
  calculatedAge: number;
}> {
  return withTransaction(async (client) => {
    const playerCode = createPlayerCode();
    const calculatedAge = calculateAgeFromDateOfBirth(payload.player.dateOfBirth);
    const assignedTrainingGroup = resolveTrainingGroupByAge(calculatedAge);
    const playerId = await insertPlayer(client, payload, playerCode);
    const guardianId = await insertGuardian(client, payload, playerId);

    await insertEmergencyContact(client, payload, playerId);
    await insertMedicalProfile(client, payload, playerId);
    await insertEnrollment(client, payload, playerId, assignedTrainingGroup);
    await insertConsents(client, payload, playerId, guardianId);
    await assignMonthlyFee(client, payload, playerId);

    const invoice = await createRegistrationInvoice(client, playerId, guardianId);
    await scheduleReminderEvents(client, invoice.id, invoice.dueDate, { source: 'registration' });

    return {
      playerId,
      playerCode,
      guardianId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      assignedTrainingGroup,
      calculatedAge
    };
  });
}

async function insertPlayer(client: PoolClient, payload: RegistrationPayload, playerCode: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO players (
        player_code,
        first_name,
        last_name,
        date_of_birth,
        gender,
        id_or_birth_cert_no,
        address_line_1,
        address_line_2,
        town,
        region,
        school_name,
        school_grade,
        preferred_position,
        preferred_foot,
        years_of_experience,
        previous_club
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16
      )
      RETURNING id
    `,
    [
      playerCode,
      payload.player.firstName,
      payload.player.lastName,
      payload.player.dateOfBirth,
      payload.player.gender,
      payload.player.idOrBirthCertNo ?? null,
      payload.player.addressLine1 ?? null,
      payload.player.addressLine2 ?? null,
      payload.player.town ?? null,
      payload.player.region ?? null,
      payload.player.schoolName ?? null,
      payload.player.schoolGrade ?? null,
      payload.player.preferredPosition ?? null,
      payload.player.preferredFoot,
      payload.player.yearsOfExperience ?? null,
      payload.player.previousClub ?? null
    ]
  );

  const playerId = result.rows[0]?.id;
  if (!playerId) {
    throw new HttpError(500, 'Failed to create player');
  }
  return playerId;
}

async function insertGuardian(client: PoolClient, payload: RegistrationPayload, playerId: string): Promise<string> {
  const guardianResult = await client.query<{ id: string }>(
    `
      INSERT INTO guardians (
        first_name,
        last_name,
        phone_whatsapp,
        alternate_phone,
        email,
        address_line_1,
        address_line_2,
        town,
        region
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
    [
      payload.guardian.firstName,
      payload.guardian.lastName,
      payload.guardian.phoneWhatsapp,
      payload.guardian.alternatePhone ?? null,
      payload.guardian.email ?? null,
      payload.guardian.addressLine1 ?? null,
      payload.guardian.addressLine2 ?? null,
      payload.guardian.town ?? null,
      payload.guardian.region ?? null
    ]
  );

  const guardianId = guardianResult.rows[0]?.id;
  if (!guardianId) {
    throw new HttpError(500, 'Failed to create guardian');
  }

  await client.query(
    `
      INSERT INTO player_guardians (
        player_id,
        guardian_id,
        relationship_to_player,
        is_primary_contact,
        is_billing_contact
      )
      VALUES ($1, $2, $3, TRUE, TRUE)
    `,
    [playerId, guardianId, payload.guardian.relationshipToPlayer]
  );

  return guardianId;
}

async function insertEmergencyContact(client: PoolClient, payload: RegistrationPayload, playerId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO emergency_contacts (
        player_id,
        full_name,
        relationship_to_player,
        phone,
        priority
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      playerId,
      payload.emergencyContact.fullName,
      payload.emergencyContact.relationshipToPlayer,
      payload.emergencyContact.phone,
      payload.emergencyContact.priority
    ]
  );
}

async function insertMedicalProfile(client: PoolClient, payload: RegistrationPayload, playerId: string): Promise<void> {
  await client.query(
    `
      INSERT INTO medical_profiles (
        player_id,
        medical_conditions,
        allergies,
        has_asthma,
        injury_history,
        current_medication,
        medical_aid_provider,
        medical_aid_number,
        doctor_or_clinic_name,
        doctor_phone,
        emergency_treatment_consent
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11
      )
    `,
    [
      playerId,
      payload.medical.medicalConditions ?? null,
      payload.medical.allergies ?? null,
      payload.medical.hasAsthma,
      payload.medical.injuryHistory ?? null,
      payload.medical.currentMedication ?? null,
      payload.medical.medicalAidProvider ?? null,
      payload.medical.medicalAidNumber ?? null,
      payload.medical.doctorOrClinicName ?? null,
      payload.medical.doctorPhone ?? null,
      payload.medical.emergencyTreatmentConsent
    ]
  );
}

async function insertEnrollment(
  client: PoolClient,
  payload: RegistrationPayload,
  playerId: string,
  autoGroupCode: AutoTrainingGroupCode
): Promise<void> {
  const groupResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM training_groups
      WHERE code = $1 AND is_active = TRUE
      LIMIT 1
    `,
    [autoGroupCode]
  );

  const trainingGroupId = groupResult.rows[0]?.id;
  if (!trainingGroupId) {
    throw new HttpError(
      400,
      `Training group ${autoGroupCode} does not exist. Seed groups first.`
    );
  }

  await client.query(
    `
      INSERT INTO enrollments (
        player_id,
        training_group_id,
        uniform_size,
        notes
      )
      VALUES ($1, $2, $3, $4)
    `,
    [
      playerId,
      trainingGroupId,
      payload.training?.uniformSize ?? null,
      payload.training?.notes ?? null
    ]
  );
}

async function insertConsents(
  client: PoolClient,
  payload: RegistrationPayload,
  playerId: string,
  guardianId: string
): Promise<void> {
  const signedBy = `${payload.guardian.firstName} ${payload.guardian.lastName}`.trim();
  const consentRows: Array<{ kind: string; granted: boolean }> = [
    { kind: 'academy_terms', granted: payload.consents.academyTerms },
    { kind: 'media_permission', granted: payload.consents.mediaPermission },
    { kind: 'data_processing', granted: payload.consents.dataProcessing },
    { kind: 'emergency_treatment', granted: payload.medical.emergencyTreatmentConsent }
  ];

  for (const consent of consentRows) {
    await client.query(
      `
        INSERT INTO consents (
          player_id,
          guardian_id,
          consent_kind,
          granted,
          signed_by_name
        )
        VALUES ($1, $2, $3::consent_type, $4, $5)
      `,
      [playerId, guardianId, consent.kind, consent.granted, signedBy]
    );
  }
}

async function assignMonthlyFee(client: PoolClient, payload: RegistrationPayload, playerId: string): Promise<void> {
  const feePlanResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM fee_plans
      WHERE code = 'MONTHLY_SUBSCRIPTION' AND is_active = TRUE
      LIMIT 1
    `
  );

  const feePlanId = feePlanResult.rows[0]?.id;
  if (!feePlanId) {
    throw new HttpError(500, 'MONTHLY_SUBSCRIPTION fee plan is missing');
  }

  await client.query(
    `
      INSERT INTO player_fee_assignments (
        player_id,
        fee_plan_id,
        due_day_of_month,
        is_active
      )
      VALUES ($1, $2, $3, TRUE)
    `,
    [playerId, feePlanId, payload.billing.dueDayOfMonth]
  );
}

async function createRegistrationInvoice(
  client: PoolClient,
  playerId: string,
  guardianId: string
): Promise<{ id: string; invoiceNumber: string; dueDate: string }> {
  const feePlanResult = await client.query<FeePlanRow>(
    `
      SELECT id, amount::text, currency
      FROM fee_plans
      WHERE code = 'REGISTRATION_ONCE' AND is_active = TRUE
      LIMIT 1
    `
  );

  const feePlan = feePlanResult.rows[0];
  if (!feePlan) {
    throw new HttpError(500, 'REGISTRATION_ONCE fee plan is missing');
  }

  const issueDate = dayjs().format('YYYY-MM-DD');
  const dueDate = dayjs().add(3, 'day').format('YYYY-MM-DD');
  const invoiceNumber = createInvoiceNumber('REG');
  const amount = Number(feePlan.amount);

  const invoiceResult = await client.query<{ id: string }>(
    `
      INSERT INTO invoices (
        invoice_number,
        player_id,
        billing_guardian_id,
        issue_date,
        due_date,
        status,
        subtotal_amount,
        total_amount,
        currency,
        sent_at
      )
      VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6, $7, NOW())
      RETURNING id
    `,
    [invoiceNumber, playerId, guardianId, issueDate, dueDate, amount, feePlan.currency]
  );

  const invoiceId = invoiceResult.rows[0]?.id;
  if (!invoiceId) {
    throw new HttpError(500, 'Failed to create registration invoice');
  }

  await client.query(
    `
      INSERT INTO invoice_items (
        invoice_id,
        fee_plan_id,
        description,
        quantity,
        unit_amount,
        line_total
      )
      VALUES ($1, $2, 'Registration Fee', 1, $3, $3)
    `,
    [invoiceId, feePlan.id, amount]
  );

  return {
    id: invoiceId,
    invoiceNumber,
    dueDate
  };
}
