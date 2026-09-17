/**
 * Admin API — Seasons CRUD
 *
 * GET    /api/admin/seasons              — List all seasons (admin view, includes leaderboards)
 * POST   /api/admin/seasons              — Create a new season (auto-creates leaderboards)
 * PATCH  /api/admin/seasons              — Update an existing season (label, dates, status, etc.)
 *
 * Auto-creates the following leaderboards based on kind:
 *   kind='main' + isPickemActive=true  → open, graded, pickem (3 leaderboards)
 *   kind='main' + isPickemActive=false → open, graded (2 leaderboards)
 *   kind='event' (pickem flag ignored, forced false) → open, graded (2 leaderboards)
 *
 * Status transitions (validated on PATCH):
 *   upcoming → active → ended → archived
 *   Cannot skip ahead (e.g. upcoming → ended is rejected).
 *   Cannot reverse (e.g. ended → active is rejected).
 *   Setting status='archived' is NOT done here — use POST /api/admin/seasons/archive instead.
 *
 * Auto-end rule: setting status='active' on a 'main' season will auto-end any other
 *   main season that is currently 'active' (sets end_date=today, status='ended').
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

const VALID_KINDS = ['main', 'event'];
const VALID_STATUSES = ['upcoming', 'active', 'ended', 'archived'];
const SEASON_ID_REGEX = /^[a-z0-9-]+$/;

// ============================================================
// GET — List all seasons (admin view)
// ============================================================
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');
    const kindFilter = url.searchParams.get('kind');

    let query = `SELECT id, label, kind, start_date, end_date, status, description,
                        is_pickem_active, archived_at, created_at, updated_at
                 FROM seasons`;
    const conditions = [];
    const params = [];
    if (statusFilter && VALID_STATUSES.includes(statusFilter)) {
      conditions.push('status = ?');
      params.push(statusFilter);
    }
    if (kindFilter && VALID_KINDS.includes(kindFilter)) {
      conditions.push('kind = ?');
      params.push(kindFilter);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ` ORDER BY
                 CASE status WHEN 'upcoming' THEN 0 WHEN 'active' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END,
                 start_date DESC`;

    const { results: seasons } = await db.prepare(query).bind(...params).all();

    // Fetch leaderboards + race counts in one batch
    const seasonIds = seasons.map(s => s.id);
    let leaderboardsBySeason = {};
    let raceCountBySeason = {};

    if (seasonIds.length > 0) {
      const placeholders = seasonIds.map(() => '?').join(',');
      const { results: lbs } = await db
        .prepare(`SELECT id, season_id, division, display_name, is_active
                  FROM leaderboards
                  WHERE season_id IN (${placeholders})
                  ORDER BY season_id, division`)
        .bind(...seasonIds)
        .all();
      for (const lb of lbs) {
        if (!leaderboardsBySeason[lb.season_id]) leaderboardsBySeason[lb.season_id] = [];
        leaderboardsBySeason[lb.season_id].push({
          id: lb.id,
          division: lb.division,
          displayName: lb.display_name || '',
          isActive: lb.is_active === 1,
        });
      }

      const { results: raceCounts } = await db
        .prepare(`SELECT season_id, COUNT(*) AS count
                   FROM weekly_races
                   WHERE season_id IN (${placeholders})
                   GROUP BY season_id`)
        .bind(...seasonIds)
        .all();
      for (const rc of raceCounts) {
        raceCountBySeason[rc.season_id] = rc.count;
      }
    }

    const payload = seasons.map(s => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      startDate: s.start_date,
      endDate: s.end_date,
      status: s.status,
      description: s.description || '',
      isPickemActive: s.is_pickem_active === 1,
      archivedAt: s.archived_at,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      leaderboards: leaderboardsBySeason[s.id] || [],
      raceCount: raceCountBySeason[s.id] || 0,
    }));

    return successResponse('Seasons loaded.', { seasons: payload });
  } catch (error) {
    console.error('Admin seasons list error:', error.message, error.stack);
    return errorResponse('Failed to load seasons.', 500);
  }
}

// ============================================================
// POST — Create a new season (auto-creates leaderboards)
// ============================================================
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    // Validate ID
    if (!data.id || typeof data.id !== 'string' || !SEASON_ID_REGEX.test(data.id) || data.id.length < 3 || data.id.length > 30) {
      return errorResponse('id is required, must be 3-30 chars, lowercase letters/numbers/hyphens only (e.g. "2026s2", "merdeka-2027").');
    }

    // Validate label
    const labelResult = validateField(data.label, 100, 'Label');
    if (!labelResult.valid) return errorResponse(labelResult.error);

    // Validate kind
    const kind = (data.kind || 'main').toLowerCase();
    if (!VALID_KINDS.includes(kind)) {
      return errorResponse('kind must be "main" or "event".');
    }

    // Validate start_date (simple ISO date check: YYYY-MM-DD)
    if (!data.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) {
      return errorResponse('startDate is required in YYYY-MM-DD format.');
    }

    // Validate end_date if provided
    let endDate = null;
    if (data.endDate !== undefined && data.endDate !== null && data.endDate !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.endDate)) {
        return errorResponse('endDate must be in YYYY-MM-DD format or null.');
      }
      if (data.endDate <= data.startDate) {
        return errorResponse('endDate must be after startDate.');
      }
      endDate = data.endDate;
    }

    // Validate description (optional)
    const descResult = validateOptionalField(data.description, 2000, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    // Pick'em logic: forced to false for event seasons
    const isPickemActive = kind === 'event' ? false : (data.isPickemActive === true || data.isPickemActive === 1);

    // Status defaults to 'upcoming' unless explicitly set (and validated)
    let status = 'upcoming';
    if (data.status !== undefined) {
      if (!VALID_STATUSES.includes(data.status)) {
        return errorResponse('status must be one of: upcoming, active, ended, archived.');
      }
      if (data.status === 'archived') {
        return errorResponse('Cannot create a season already in archived status. Use the archive endpoint after creation + ending.');
      }
      status = data.status;
    }

    // Check for duplicate ID
    const existing = await db.prepare('SELECT id FROM seasons WHERE id = ?').bind(data.id).first();
    if (existing) {
      return errorResponse(`Season id "${data.id}" already exists. Choose a different id.`, 409);
    }

    // If creating a main season as 'active', auto-end any currently-active main season
    if (kind === 'main' && status === 'active') {
      await autoEndActiveMainSeasons(db);
    }

    // Insert season
    await db
      .prepare(
        `INSERT INTO seasons (id, label, kind, start_date, end_date, status, description, is_pickem_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(data.id, labelResult.value, kind, data.startDate, endDate, status, descResult.value || '', isPickemActive ? 1 : 0)
      .run();

    // Auto-create leaderboards
    const divisionsToCreate = kind === 'event'
      ? ['open', 'graded']
      : (isPickemActive ? ['open', 'graded', 'pickem'] : ['open', 'graded']);

    for (const division of divisionsToCreate) {
      await db
        .prepare(
          `INSERT INTO leaderboards (season_id, division, display_name, is_active)
           VALUES (?, ?, '', 1)`
        )
        .bind(data.id, division)
        .run();
    }

    // Fetch the created leaderboards to return their IDs
    const { results: createdLbs } = await db
      .prepare(`SELECT id, division FROM leaderboards WHERE season_id = ? ORDER BY division`)
      .bind(data.id)
      .all();

    return successResponse(`Season "${data.id}" created with ${divisionsToCreate.length} leaderboard(s).`, {
      season: {
        id: data.id,
        label: labelResult.value,
        kind,
        startDate: data.startDate,
        endDate,
        status,
        description: descResult.value || '',
        isPickemActive,
      },
      leaderboards: createdLbs.map(lb => ({ id: lb.id, division: lb.division })),
    });
  } catch (error) {
    console.error('Admin create season error:', error.message, error.stack);
    return errorResponse(`Failed to create season: ${error.message}`, 500);
  }
}

// ============================================================
// PATCH — Update an existing season
// ============================================================
export async function onRequestPatch(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.id || typeof data.id !== 'string') {
      return errorResponse('id (season id) is required in the request body.');
    }

    // Fetch current state
    const current = await db
      .prepare(`SELECT id, label, kind, start_date, end_date, status, description, is_pickem_active
                FROM seasons WHERE id = ?`)
      .bind(data.id)
      .first();

    if (!current) {
      return errorResponse(`Season "${data.id}" not found.`, 404);
    }

    // Archived seasons are immutable
    if (current.status === 'archived') {
      return errorResponse(`Season "${data.id}" is archived and cannot be modified. Archived seasons are immutable.`, 409);
    }

    // Build update fields
    const updates = [];
    const params = [];

    if (data.label !== undefined) {
      const labelResult = validateField(data.label, 100, 'Label');
      if (!labelResult.valid) return errorResponse(labelResult.error);
      updates.push('label = ?');
      params.push(labelResult.value);
    }

    if (data.startDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.startDate)) {
        return errorResponse('startDate must be in YYYY-MM-DD format.');
      }
      updates.push('start_date = ?');
      params.push(data.startDate);
    }

    if (data.endDate !== undefined) {
      let endDate = null;
      if (data.endDate !== null && data.endDate !== '') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.endDate)) {
          return errorResponse('endDate must be in YYYY-MM-DD format or null.');
        }
        const newStart = data.startDate || current.start_date;
        if (data.endDate <= newStart) {
          return errorResponse('endDate must be after startDate.');
        }
        endDate = data.endDate;
      }
      updates.push('end_date = ?');
      params.push(endDate);
    }

    if (data.description !== undefined) {
      const descResult = validateOptionalField(data.description, 2000, 'Description');
      if (!descResult.valid) return errorResponse(descResult.error);
      updates.push('description = ?');
      params.push(descResult.value || '');
    }

    // isPickemActive: can be toggled, but only for main seasons, and only while upcoming/active
    if (data.isPickemActive !== undefined) {
      if (current.kind === 'event') {
        return errorResponse('Pick\'em cannot be enabled on event seasons — Pick\'em is exclusive to main weekly/biweekly seasons.');
      }
      // Main season — but reject if already ended/archived (archived already blocked above)
      if (current.status === 'ended') {
        return errorResponse('Cannot toggle Pick\'em on a season that has already ended.');
      }
      const newValue = data.isPickemActive === true || data.isPickemActive === 1 ? 1 : 0;
      // If turning ON pickem for the first time and no pickem leaderboard exists, create it
      if (newValue === 1 && current.is_pickem_active === 0) {
        const existingPickem = await db
          .prepare('SELECT id FROM leaderboards WHERE season_id = ? AND division = ?')
          .bind(data.id, 'pickem')
          .first();
        if (!existingPickem) {
          await db
            .prepare(`INSERT INTO leaderboards (season_id, division, display_name, is_active) VALUES (?, 'pickem', '', 1)`)
            .bind(data.id)
            .run();
        }
      }
      // If turning OFF pickem, we leave the leaderboard row in place (data preserved) — just flip the flag
      updates.push('is_pickem_active = ?');
      params.push(newValue);
    }

    // Status transition (if requested)
    if (data.status !== undefined) {
      if (!VALID_STATUSES.includes(data.status)) {
        return errorResponse('status must be one of: upcoming, active, ended, archived.');
      }
      if (data.status === 'archived') {
        return errorResponse('Cannot set status to archived via PATCH. Use POST /api/admin/seasons/archive instead — it will take a snapshot first.');
      }
      // Validate transition: upcoming → active → ended (no skipping, no reversal)
      const transitionValid = (
        (current.status === 'upcoming' && data.status === 'active') ||
        (current.status === 'upcoming' && data.status === 'upcoming') ||  // no-op
        (current.status === 'active' && data.status === 'active') ||      // no-op
        (current.status === 'active' && data.status === 'ended')
      );
      if (!transitionValid) {
        return errorResponse(`Invalid status transition: ${current.status} → ${data.status}. Allowed: upcoming → active → ended. Reversal is not allowed.`, 400);
      }

      // If activating a main season, auto-end any other active main season first
      if (current.kind === 'main' && data.status === 'active' && current.status !== 'active') {
        await autoEndActiveMainSeasons(db, data.id);
      }

      // If ending the season, set end_date to today if not already set
      if (data.status === 'ended' && current.status !== 'ended') {
        const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
        // Only set end_date if it's currently null AND no explicit endDate was passed in this request
        if (current.end_date === null && !updates.includes('end_date = ?')) {
          updates.push('end_date = ?');
          params.push(today);
        } else if (current.end_date === null && updates.includes('end_date = ?')) {
          // endDate was explicitly passed in this request — keep it (already in updates)
        }
      }

      updates.push('status = ?');
      params.push(data.status);
    }

    // Always bump updated_at
    updates.push("updated_at = datetime('now')");

    if (updates.length === 1) {
      // only updated_at — nothing to actually change
      return successResponse('No changes to apply.');
    }

    params.push(data.id);  // for WHERE clause
    await db
      .prepare(`UPDATE seasons SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    // Fetch updated row
    const updated = await db
      .prepare(`SELECT id, label, kind, start_date, end_date, status, description, is_pickem_active, updated_at
                FROM seasons WHERE id = ?`)
      .bind(data.id)
      .first();

    return successResponse(`Season "${data.id}" updated.`, {
      season: {
        id: updated.id,
        label: updated.label,
        kind: updated.kind,
        startDate: updated.start_date,
        endDate: updated.end_date,
        status: updated.status,
        description: updated.description || '',
        isPickemActive: updated.is_pickem_active === 1,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    console.error('Admin update season error:', error.message, error.stack);
    return errorResponse(`Failed to update season: ${error.message}`, 500);
  }
}

// ============================================================
// Helper: auto-end any active main season (excluding one)
// ============================================================
async function autoEndActiveMainSeasons(db, excludeId = null) {
  const today = new Date().toISOString().slice(0, 10);
  let query = `UPDATE seasons
               SET status = 'ended', end_date = COALESCE(end_date, ?), updated_at = datetime('now')
               WHERE kind = 'main' AND status = 'active'`;
  const params = [today];
  if (excludeId) {
    query += ' AND id != ?';
    params.push(excludeId);
  }
  await db.prepare(query).bind(...params).run();
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'PATCH', 'OPTIONS']);
}
