import { pool } from '../../db/pool.js';

type PlayerListRow = {
  player_id: string;
  player_code: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  preferred_position: string | null;
  status: string;
  joined_on: string;
  training_group_code: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
};

export async function listPlayers(input: {
  search?: string;
  status?: string;
  limit?: number;
}): Promise<PlayerListRow[]> {
  const values: unknown[] = [];
  const where: string[] = [];

  if (input.search) {
    values.push(`%${input.search.trim()}%`);
    const idx = values.length;
    where.push(
      `(p.player_code ILIKE $${idx} OR CONCAT(p.first_name, ' ', p.last_name) ILIKE $${idx})`
    );
  }

  if (input.status) {
    values.push(input.status);
    where.push(`p.status = $${values.length}`);
  }

  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  values.push(limit);

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const result = await pool.query<PlayerListRow>(
    `
      SELECT
        p.id AS player_id,
        p.player_code,
        p.first_name,
        p.last_name,
        p.date_of_birth::text,
        p.gender::text,
        p.preferred_position,
        p.status,
        p.joined_on::text,
        tg.code AS training_group_code,
        CONCAT(g.first_name, ' ', g.last_name) AS guardian_name,
        g.phone_whatsapp AS guardian_phone
      FROM players p
      LEFT JOIN LATERAL (
        SELECT e.training_group_id
        FROM enrollments e
        WHERE e.player_id = p.id
        ORDER BY e.created_at DESC
        LIMIT 1
      ) latest_enrollment ON TRUE
      LEFT JOIN training_groups tg ON tg.id = latest_enrollment.training_group_id
      LEFT JOIN LATERAL (
        SELECT pg.guardian_id
        FROM player_guardians pg
        WHERE pg.player_id = p.id AND pg.is_primary_contact = TRUE
        ORDER BY pg.created_at DESC
        LIMIT 1
      ) primary_guardian ON TRUE
      LEFT JOIN guardians g ON g.id = primary_guardian.guardian_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${values.length}
    `,
    values
  );
  return result.rows;
}

export async function getPlayerDetails(playerId: string): Promise<{
  player: Record<string, unknown>;
  guardians: Array<Record<string, unknown>>;
  emergencyContacts: Array<Record<string, unknown>>;
  medical: Record<string, unknown> | null;
} | null> {
  const playerResult = await pool.query(
    `
      SELECT
        p.*,
        tg.code AS training_group_code,
        tg.display_name AS training_group_name
      FROM players p
      LEFT JOIN LATERAL (
        SELECT e.training_group_id
        FROM enrollments e
        WHERE e.player_id = p.id
        ORDER BY e.created_at DESC
        LIMIT 1
      ) latest_enrollment ON TRUE
      LEFT JOIN training_groups tg ON tg.id = latest_enrollment.training_group_id
      WHERE p.id = $1
      LIMIT 1
    `,
    [playerId]
  );

  const player = playerResult.rows[0];
  if (!player) {
    return null;
  }

  const guardiansResult = await pool.query(
    `
      SELECT
        g.*,
        pg.relationship_to_player,
        pg.is_primary_contact,
        pg.is_billing_contact
      FROM player_guardians pg
      INNER JOIN guardians g ON g.id = pg.guardian_id
      WHERE pg.player_id = $1
      ORDER BY pg.is_primary_contact DESC, pg.created_at ASC
    `,
    [playerId]
  );

  const emergencyResult = await pool.query(
    `
      SELECT *
      FROM emergency_contacts
      WHERE player_id = $1
      ORDER BY priority ASC
    `,
    [playerId]
  );

  const medicalResult = await pool.query(
    `
      SELECT *
      FROM medical_profiles
      WHERE player_id = $1
      LIMIT 1
    `,
    [playerId]
  );

  return {
    player,
    guardians: guardiansResult.rows,
    emergencyContacts: emergencyResult.rows,
    medical: medicalResult.rows[0] ?? null
  };
}

