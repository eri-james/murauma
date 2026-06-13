/**
 * POST /api/admin/migrate — Run pending database migrations (Admin only)
 *
 * Executes schema migrations that cannot be run via CLI due to missing
 * API token in the deployment environment.
 *
 * Each migration is idempotent — safe to re-run.
 */
import {
  errorResponse,
  successResponse,
  requireAdmin,
  adminPreflightResponse,
} from '../../../_shared/utils.js';

// ============================================================
// MIGRATIONS REGISTRY
// ============================================================
const MIGRATIONS = [
  {
    id: '012',
    name: 'hero-banner-video-type',
    description: 'Add video media type to hero_banner CHECK constraint',
    sql: [
      `CREATE TABLE IF NOT EXISTS hero_banner_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
          description TEXT NOT NULL DEFAULT '',
          link_url TEXT NOT NULL DEFAULT '' CHECK(length(link_url) <= 2000),
          media_type TEXT NOT NULL DEFAULT 'youtube' CHECK(media_type IN ('youtube', 'image', 'video')),
          media_url TEXT NOT NULL DEFAULT '' CHECK(length(media_url) <= 2000),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `INSERT INTO hero_banner_new (id, title, description, link_url, media_type, media_url, is_active, created_at, updated_at)
       SELECT id, title, description, link_url, media_type, media_url, is_active, created_at, updated_at
       FROM hero_banner`,
      `DROP TABLE hero_banner`,
      `ALTER TABLE hero_banner_new RENAME TO hero_banner`,
      `CREATE INDEX IF NOT EXISTS idx_hero_banner_active ON hero_banner(is_active)`,
    ],
  },
];

// ============================================================
// ENDPOINTS
// ============================================================

/**
 * GET /api/admin/migrate — List pending and applied migrations
 */
export async function onRequestGet(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    // Ensure migration_log table exists
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS migration_log (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    const { results: applied } = await db.prepare('SELECT id, name, applied_at FROM migration_log ORDER BY id').all();
    const appliedIds = new Set(applied.map(r => r.id));

    const pending = MIGRATIONS.filter(m => !appliedIds.has(m.id));
    const appliedList = applied.map(r => ({ id: r.id, name: r.name, appliedAt: r.applied_at }));

    return successResponse('Migration status loaded.', { pending, applied: appliedList });
  } catch (error) {
    console.error('Migration list error:', error.message);
    return errorResponse('Failed to list migrations.', 500);
  }
}

/**
 * POST /api/admin/migrate — Run all pending migrations
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;

  const { user, error: authError } = await requireAdmin(request, env);
  if (authError) return authError;

  try {
    // Ensure migration_log table exists
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS migration_log (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();

    const { results: applied } = await db.prepare('SELECT id FROM migration_log').all();
    const appliedIds = new Set(applied.map(r => r.id));

    const pending = MIGRATIONS.filter(m => !appliedIds.has(m.id));

    if (pending.length === 0) {
      return successResponse('No pending migrations.');
    }

    const results = [];

    for (const migration of pending) {
      try {
        for (const sql of migration.sql) {
          await db.prepare(sql).run();
        }
        // Log successful migration
        await db.prepare('INSERT INTO migration_log (id, name) VALUES (?, ?)')
          .bind(migration.id, migration.name)
          .run();
        results.push({ id: migration.id, name: migration.name, status: 'success' });
      } catch (err) {
        results.push({ id: migration.id, name: migration.name, status: 'failed', error: err.message });
        // Stop on first failure — don't run subsequent migrations
        break;
      }
    }

    return successResponse('Migration complete.', { results });
  } catch (error) {
    console.error('Migration run error:', error.message);
    return errorResponse('Migration failed: ' + error.message, 500);
  }
}

export function onRequestOptions() {
  return adminPreflightResponse(['GET', 'POST', 'OPTIONS']);
}
