/**
 * Admin API — Weekly Race Management (List, Create, Delete)
 *
 * GET    /api/admin/weekly-races?status=published  — List weekly races
 * POST   /api/admin/weekly-races                   — Create a new weekly race
 * DELETE /api/admin/weekly-races                   — Delete a weekly race by ID
 */
import {
  errorResponse,
  successResponse,
  validateField,
  validateOptionalField,
  sanitizeRichHtml,
  generateSlug,
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
    const status = url.searchParams.get('status') || 'all';

    let query, params;
    if (status !== 'all' && ['draft', 'published'].includes(status)) {
      query = `SELECT id, title, slug, track, deadline, description, image_url, is_active, status, created_at, updated_at,
               LENGTH(content) AS content_length
               FROM weekly_races WHERE status = ? ORDER BY created_at DESC`;
      params = [status];
    } else {
      query = `SELECT id, title, slug, track, deadline, description, image_url, is_active, status, created_at, updated_at,
               LENGTH(content) AS content_length
               FROM weekly_races ORDER BY created_at DESC`;
      params = [];
    }

    const { results } = await db.prepare(query).bind(...params).all();

    const items = results.map(row => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      track: row.track,
      deadline: row.deadline,
      description: row.description || '',
      imageUrl: row.image_url || '',
      isActive: row.is_active === 1,
      status: row.status,
      contentLength: row.content_length || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return successResponse('Weekly races loaded.', { items });
  } catch (error) {
    console.error('Admin list weekly races error:', error.message);
    return errorResponse('Failed to list weekly races.', 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    // Validate required fields
    const titleResult = validateField(data.title, 200, 'Title');
    if (!titleResult.valid) return errorResponse(titleResult.error);

    const trackResult = validateField(data.track, 200, 'Track');
    if (!trackResult.valid) return errorResponse(trackResult.error);

    const deadlineResult = validateField(data.deadline, 100, 'Deadline');
    if (!deadlineResult.valid) return errorResponse(deadlineResult.error);

    const descResult = validateOptionalField(data.description, 2000, 'Description');
    if (!descResult.valid) return errorResponse(descResult.error);

    const imageUrlResult = validateOptionalField(data.imageUrl, 2000, 'Image URL');
    if (!imageUrlResult.valid) return errorResponse(imageUrlResult.error);

    // Content is rich HTML (optional on create)
    let sanitizedContent = '';
    if (data.content && typeof data.content === 'string') {
      if (data.content.length > 500000) {
        return errorResponse('Content must be 500KB or less.');
      }
      sanitizedContent = sanitizeRichHtml(data.content);
    }

    // Generate unique slug
    let slug = data.slug ? data.slug.trim().toLowerCase() : generateSlug(titleResult.value);
    if (!slug || slug.length === 0) {
      slug = `race-${Date.now()}`;
    }

    const existing = await db.prepare('SELECT id FROM weekly_races WHERE slug = ?').bind(slug).first();
    if (existing) {
      let suffix = 2;
      let newSlug = `${slug}-${suffix}`;
      while (await db.prepare('SELECT id FROM weekly_races WHERE slug = ?').bind(newSlug).first()) {
        suffix++;
        newSlug = `${slug}-${suffix}`;
      }
      slug = newSlug;
    }

    const isActive = data.isActive === false ? 0 : 1;
    const status = data.status === 'draft' ? 'draft' : 'published';

    // Resolve season_id: explicit override > active main season > null
    let seasonId = null;
    if (data.seasonId !== undefined && data.seasonId !== null && data.seasonId !== '') {
      // Explicit season assignment — validate it exists and isn't archived
      if (typeof data.seasonId !== 'string' || data.seasonId.length > 50) {
        return errorResponse('seasonId must be a string of 50 chars or less.');
      }
      const seasonCheck = await db
        .prepare(`SELECT id, status FROM seasons WHERE id = ?`)
        .bind(data.seasonId)
        .first();
      if (!seasonCheck) {
        return errorResponse(`Season "${data.seasonId}" not found.`);
      }
      if (seasonCheck.status === 'archived') {
        return errorResponse(`Season "${data.seasonId}" is archived — cannot add new races to an archived season.`);
      }
      seasonId = data.seasonId;
    } else {
      // Auto-resolve: use the active main season, if any
      const activeMain = await db
        .prepare(`SELECT id FROM seasons WHERE kind = 'main' AND status = 'active' LIMIT 1`)
        .first();
      if (activeMain) {
        seasonId = activeMain.id;
      }
    }

    await db
      .prepare(
        `INSERT INTO weekly_races (title, slug, track, deadline, description, content, image_url, is_active, status, season_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        titleResult.value,
        slug,
        trackResult.value,
        deadlineResult.value,
        descResult.value || '',
        sanitizedContent,
        imageUrlResult.value || null,
        isActive,
        status,
        seasonId
      )
      .run();

    // Fetch the new race ID (needed for binding creation)
    const newRace = await db
      .prepare('SELECT id FROM weekly_races WHERE slug = ?')
      .bind(slug)
      .first();

    // Auto-bind to leaderboards if we resolved a season_id
    // - Always bind to open + graded leaderboards of that season
    // - Bind to pickem leaderboard only if the season has is_pickem_active=1
    // - Note: Pick'em is graded-only, so pickem binding is added regardless of
    //   which division the race uses. The race-predictions endpoint validates
    //   that predictions only work for races with graded participants.
    let boundLeaderboards = [];
    if (newRace && seasonId) {
      // Fetch season's pickem-active flag
      const seasonInfo = await db
        .prepare('SELECT is_pickem_active FROM seasons WHERE id = ?')
        .bind(seasonId)
        .first();
      const pickemActive = seasonInfo?.is_pickem_active === 1;

      // Determine which divisions to bind
      const divisionsToBind = pickemActive
        ? ['open', 'graded', 'pickem']
        : ['open', 'graded'];

      // Fetch the leaderboard IDs for those divisions in this season
      const placeholders = divisionsToBind.map(() => '?').join(',');
      const { results: seasonLbs } = await db
        .prepare(
          `SELECT id, division FROM leaderboards
           WHERE season_id = ? AND is_active = 1 AND division IN (${placeholders})`
        )
        .bind(seasonId, ...divisionsToBind)
        .all();

      for (const lb of seasonLbs) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id) VALUES (?, ?)`
          )
          .bind(newRace.id, lb.id)
          .run();
        boundLeaderboards.push({ leaderboardId: lb.id, division: lb.division });
      }
    }

    return successResponse('Weekly race created successfully.', {
      slug,
      raceId: newRace?.id || null,
      seasonId,
      boundLeaderboards,
    });
  } catch (error) {
    console.error('Admin create weekly race error:', error.message);
    return errorResponse('Failed to create weekly race.', 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    const data = await request.json();

    if (!data.id || !Number.isInteger(data.id)) {
      return errorResponse('Valid weekly race ID (integer) is required.');
    }

    const existing = await db
      .prepare('SELECT id, title FROM weekly_races WHERE id = ?')
      .bind(data.id)
      .first();

    if (!existing) {
      return errorResponse('Weekly race not found.');
    }

    await db.prepare('DELETE FROM weekly_races WHERE id = ?').bind(data.id).run();

    return successResponse(`Weekly race #${data.id} ("${existing.title}") has been deleted.`);
  } catch (error) {
    console.error('Admin delete weekly race error:', error.message);
    return errorResponse('Failed to delete weekly race.', 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'DELETE', 'OPTIONS']);
}
