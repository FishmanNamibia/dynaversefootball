import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { HttpError } from '../../utils/httpError.js';
import type { CreateSessionInput, UpsertAttendanceInput } from './attendance.types.js';

export async function createAttendanceSession(payload: CreateSessionInput): Promise<{ sessionId: string }> {
  return withTransaction(async (client) => {
    const groupResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM training_groups
        WHERE code = $1 AND is_active = TRUE
        LIMIT 1
      `,
      [payload.groupCode]
    );

    const groupId = groupResult.rows[0]?.id;
    if (!groupId) {
      throw new HttpError(404, `Training group ${payload.groupCode} not found`);
    }

    const sessionResult = await client.query<{ id: string }>(
      `
        INSERT INTO attendance_sessions (
          training_group_id,
          session_date,
          start_time,
          end_time,
          notes
        )
        VALUES ($1, $2::date, $3::time, $4::time, $5)
        RETURNING id
      `,
      [
        groupId,
        payload.sessionDate,
        payload.startTime ?? null,
        payload.endTime ?? null,
        payload.notes ?? null
      ]
    );

    const sessionId = sessionResult.rows[0]?.id;
    if (!sessionId) {
      throw new HttpError(500, 'Failed to create attendance session');
    }

    await client.query(
      `
        INSERT INTO attendance_records (
          attendance_session_id,
          player_id,
          status
        )
        SELECT
          $1,
          e.player_id,
          'absent'::attendance_status_type
        FROM enrollments e
        WHERE
          e.training_group_id = $2
          AND e.status = 'active'
      `,
      [sessionId, groupId]
    );

    return { sessionId };
  });
}

export async function upsertAttendance(
  sessionId: string,
  payload: UpsertAttendanceInput
): Promise<{ updated: number }> {
  return withTransaction(async (client) => {
    const sessionExists = await client.query<{ id: string }>(
      `
        SELECT id
        FROM attendance_sessions
        WHERE id = $1
        LIMIT 1
      `,
      [sessionId]
    );
    if (sessionExists.rows.length === 0) {
      throw new HttpError(404, 'Attendance session not found');
    }

    let updated = 0;
    for (const record of payload.records) {
      const playerResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM players
          WHERE player_code = $1
          LIMIT 1
        `,
        [record.playerCode]
      );
      const playerId = playerResult.rows[0]?.id;
      if (!playerId) {
        continue;
      }

      await client.query(
        `
          INSERT INTO attendance_records (
            attendance_session_id,
            player_id,
            status,
            arrival_time,
            notes
          )
          VALUES ($1, $2, $3::attendance_status_type, $4::time, $5)
          ON CONFLICT (attendance_session_id, player_id)
          DO UPDATE SET
            status = EXCLUDED.status,
            arrival_time = EXCLUDED.arrival_time,
            notes = EXCLUDED.notes
        `,
        [sessionId, playerId, record.status, record.arrivalTime ?? null, record.notes ?? null]
      );
      updated += 1;
    }

    return { updated };
  });
}

export async function listSessions(limit = 30): Promise<
  Array<{
    session_id: string;
    session_date: string;
    group_code: string;
    present_count: number;
    absent_count: number;
    total_count: number;
  }>
> {
  const result = await pool.query<{
    session_id: string;
    session_date: string;
    group_code: string;
    present_count: string;
    absent_count: string;
    total_count: string;
  }>(
    `
      SELECT
        s.id AS session_id,
        s.session_date::text,
        g.code AS group_code,
        COUNT(*) FILTER (WHERE r.status = 'present')::text AS present_count,
        COUNT(*) FILTER (WHERE r.status = 'absent')::text AS absent_count,
        COUNT(*)::text AS total_count
      FROM attendance_sessions s
      INNER JOIN training_groups g ON g.id = s.training_group_id
      LEFT JOIN attendance_records r ON r.attendance_session_id = s.id
      GROUP BY s.id, g.code
      ORDER BY s.session_date DESC
      LIMIT $1
    `,
    [Math.min(Math.max(limit, 1), 200)]
  );

  return result.rows.map((row) => ({
    session_id: row.session_id,
    session_date: row.session_date,
    group_code: row.group_code,
    present_count: Number(row.present_count),
    absent_count: Number(row.absent_count),
    total_count: Number(row.total_count)
  }));
}

