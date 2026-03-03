import { pool } from '../../db/pool.js';

export async function listTrainingGroups(): Promise<
  Array<{
    id: string;
    code: string;
    display_name: string;
    coach_name: string | null;
  }>
> {
  const result = await pool.query<{
    id: string;
    code: string;
    display_name: string;
    coach_name: string | null;
  }>(
    `
      SELECT
        tg.id,
        tg.code,
        tg.display_name,
        c.full_name AS coach_name
      FROM training_groups tg
      LEFT JOIN coaches c ON c.id = tg.coach_id
      WHERE tg.is_active = TRUE
      ORDER BY tg.code ASC
    `
  );
  return result.rows;
}

export async function listCoaches(): Promise<
  Array<{
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  }>
> {
  const result = await pool.query<{
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
  }>(
    `
      SELECT id, full_name, phone, email
      FROM coaches
      WHERE is_active = TRUE
      ORDER BY full_name ASC
    `
  );
  return result.rows;
}

