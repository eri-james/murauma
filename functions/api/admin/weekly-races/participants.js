/**
 * Admin API — Race Participants Management
 *
 * GET    /api/admin/weekly-races/participants?raceId=N  — List participants for a race
 * POST   /api/admin/weekly-races/participants            — Add a participant to a race
 * DELETE /api/admin/weekly-races/participants            — Remove a participant from a race
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const raceId = parseInt(url.searchParams.get('raceId'), 10);
    if (!raceId || isNaN(raceId)) {
      return errorResponse('Valid raceId is required.');
    }

    // Verify race exists
    const race = await db.prepare('SELECT id FROM weekly_races WHERE id = ?').bind(raceId).first();
    if (!race) return errorResponse('Race not found.');

    const { results } = await db
      .prepare(
        `SELECT rp.id, rp.race_id, rp.member_id, rp.position, rp.added_at,
                m.name AS member_name, m.trainer_id
         FROM race_participants rp
         JOIN members m ON m.id = rp.member_id
         WHERE rp.race_id = ?
         ORDER BY rp.added_at ASC`
      )
      .bind(raceId)
      .all();

    const participants = results.map(row => ({
      id: row.id,
      raceId: row.race_id,
      memberId: row.member_id,
      memberName: row.member_name,
      trainerId: row.trainer_id,
      avatarUrl: row.trainer_id ? `/api/avatar/${row.trainer_id}` : `/api/avatar/${row.member_id}`,
      position: row.position,
      addedAt: row.added_at,
    }));

    return successResponse('Participants loaded.', { participants });
  } catch (error) {
    console.error('Admin list participants error:', error.message);
    return errorResponse('Failed to load participants.', 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.raceId || !Number.isInteger(data.raceId)) {
      return errorResponse('Valid raceId is required.');
    }
    if (!data.memberId || !Number.isInteger(data.memberId)) {
      return errorResponse('Valid memberId is required.');
    }

    // Verify race exists
    const race = await db.prepare('SELECT id FROM weekly_races WHERE id = ?').bind(data.raceId).first();
    if (!race) return errorResponse('Race not found.');

    // Verify member exists
    const member = await db.prepare('SELECT id, name FROM members WHERE id = ?').bind(data.memberId).first();
    if (!member) return errorResponse('Member not found.');

    // Check for duplicate
    const existing = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ?')
      .bind(data.raceId, data.memberId)
      .first();
    if (existing) {
      return errorResponse(`${member.name} is already a participant in this race.`);
    }

    await db
      .prepare('INSERT INTO race_participants (race_id, member_id) VALUES (?, ?)')
      .bind(data.raceId, data.memberId)
      .run();

    return successResponse(`${member.name} added to race.`, { memberId: data.memberId });
  } catch (error) {
    console.error('Admin add participant error:', error.message);
    return errorResponse('Failed to add participant.', 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.raceId || !Number.isInteger(data.raceId)) {
      return errorResponse('Valid raceId is required.');
    }
    if (!data.memberId || !Number.isInteger(data.memberId)) {
      return errorResponse('Valid memberId is required.');
    }

    const existing = await db
      .prepare('SELECT id FROM race_participants WHERE race_id = ? AND member_id = ?')
      .bind(data.raceId, data.memberId)
      .first();
    if (!existing) {
      return errorResponse('Participant not found in this race.');
    }

    await db
      .prepare('DELETE FROM race_participants WHERE race_id = ? AND member_id = ?')
      .bind(data.raceId, data.memberId)
      .run();

    return successResponse('Participant removed from race.');
  } catch (error) {
    console.error('Admin remove participant error:', error.message);
    return errorResponse('Failed to remove participant.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'DELETE', 'OPTIONS']);
}
