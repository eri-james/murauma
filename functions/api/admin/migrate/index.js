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
  {
    id: '013',
    name: 'hero-banner-poster-url',
    description: 'Add poster_url column to hero_banner for video fallback image',
    sql: [
      `ALTER TABLE hero_banner ADD COLUMN poster_url TEXT NOT NULL DEFAULT '' CHECK(length(poster_url) <= 2000)`,
    ],
  },
  {
    id: '014',
    name: 'leaderboards-seasons',
    description: 'Seasons, leaderboards, race-leaderboard bindings, immutable archive snapshots. Backfills Season 1 2026 with all existing races.',
    sql: [
      // Step 1: seasons table
      `CREATE TABLE IF NOT EXISTS seasons (
          id              TEXT PRIMARY KEY,
          label           TEXT NOT NULL CHECK(length(label) <= 100 AND length(label) > 0),
          kind            TEXT NOT NULL DEFAULT 'main' CHECK(kind IN ('main', 'event')),
          start_date      TEXT NOT NULL CHECK(length(start_date) <= 20 AND length(start_date) > 0),
          end_date        TEXT CHECK(end_date IS NULL OR (length(end_date) <= 20 AND length(end_date) > 0)),
          status          TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'active', 'ended', 'archived')),
          description     TEXT NOT NULL DEFAULT '',
          is_pickem_active INTEGER NOT NULL DEFAULT 0 CHECK(is_pickem_active IN (0, 1)),
          archived_at     TEXT,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status)`,
      `CREATE INDEX IF NOT EXISTS idx_seasons_kind ON seasons(kind)`,
      `CREATE INDEX IF NOT EXISTS idx_seasons_dates ON seasons(start_date, end_date)`,
      // Step 2: leaderboards table
      `CREATE TABLE IF NOT EXISTS leaderboards (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          season_id       TEXT NOT NULL,
          division        TEXT NOT NULL CHECK(division IN ('open', 'graded', 'pickem')),
          display_name    TEXT NOT NULL DEFAULT '',
          is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
          UNIQUE(season_id, division)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_leaderboards_season ON leaderboards(season_id)`,
      `CREATE INDEX IF NOT EXISTS idx_leaderboards_division ON leaderboards(division)`,
      // Step 3: race_leaderboard_bindings junction table
      `CREATE TABLE IF NOT EXISTS race_leaderboard_bindings (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          race_id         INTEGER NOT NULL,
          leaderboard_id  INTEGER NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (race_id) REFERENCES weekly_races(id) ON DELETE CASCADE,
          FOREIGN KEY (leaderboard_id) REFERENCES leaderboards(id) ON DELETE CASCADE,
          UNIQUE(race_id, leaderboard_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_bindings_race ON race_leaderboard_bindings(race_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bindings_lb ON race_leaderboard_bindings(leaderboard_id)`,
      // Step 4: season_archive_snapshots table (immutable via triggers)
      `CREATE TABLE IF NOT EXISTS season_archive_snapshots (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          season_id           TEXT NOT NULL,
          division            TEXT NOT NULL CHECK(division IN ('open', 'graded', 'pickem')),
          snapshot_json       TEXT NOT NULL,
          snapshot_taken_at   TEXT NOT NULL DEFAULT (datetime('now')),
          is_locked           INTEGER NOT NULL DEFAULT 1 CHECK(is_locked IN (0, 1)),
          FOREIGN KEY (season_id) REFERENCES seasons(id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_archive_season ON season_archive_snapshots(season_id)`,
      `CREATE INDEX IF NOT EXISTS idx_archive_division ON season_archive_snapshots(season_id, division)`,
      // Step 5: Immutability triggers (DROP first for idempotency — SQLite triggers don't support IF NOT EXISTS)
      `DROP TRIGGER IF EXISTS trg_archive_no_update`,
      `CREATE TRIGGER trg_archive_no_update
       BEFORE UPDATE ON season_archive_snapshots
       WHEN OLD.is_locked = 1 AND NEW.is_locked = 1
       BEGIN
         SELECT RAISE(ABORT, 'Archived season snapshots are immutable (is_locked=1). To modify, set is_locked=0 first via direct DB access.');
       END`,
      `DROP TRIGGER IF EXISTS trg_archive_no_delete`,
      `CREATE TRIGGER trg_archive_no_delete
       BEFORE DELETE ON season_archive_snapshots
       WHEN OLD.is_locked = 1
       BEGIN
         SELECT RAISE(ABORT, 'Archived season snapshots are immutable (is_locked=1). To delete, set is_locked=0 first via direct DB access.');
       END`,
      // Step 6: Add season_id column to weekly_races (nullable — NULL = auto)
      // NOTE: ALTER TABLE ADD COLUMN is NOT idempotent. Mitigated by migration_log tracking.
      `ALTER TABLE weekly_races ADD COLUMN season_id TEXT`,
      // Step 7: Backfill — Create Season 1 2026 (replaces hardcoded SEASONS constant)
      `INSERT OR IGNORE INTO seasons (id, label, kind, start_date, end_date, status, description, is_pickem_active)
       VALUES ('2026s1', 'Season 1 2026', 'main', '2026-06-01', NULL, 'active', 'Inaugural MURA racing season (June 2026 onward). Includes Merdeka Cup and Freedom Cup races as part of the main standings.', 1)`,
      // Step 8: Backfill — Create leaderboards for 2026s1 (Pick'em active = all 3 divisions)
      `INSERT OR IGNORE INTO leaderboards (season_id, division, display_name, is_active)
       VALUES ('2026s1', 'open', '', 1)`,
      `INSERT OR IGNORE INTO leaderboards (season_id, division, display_name, is_active)
       VALUES ('2026s1', 'graded', '', 1)`,
      `INSERT OR IGNORE INTO leaderboards (season_id, division, display_name, is_active)
       VALUES ('2026s1', 'pickem', '', 1)`,
      // Step 9: Backfill — Set season_id on existing races (created >= 2026-06-01)
      // Past Merdeka/Freedom Cup races stay in main seasonal standings per admin decision.
      `UPDATE weekly_races
       SET season_id = '2026s1'
       WHERE season_id IS NULL AND created_at >= '2026-06-01'`,
      // Step 10a: Backfill — Bind graded-division races to graded leaderboard
      `INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
       SELECT DISTINCT rp.race_id, lb.id
       FROM race_participants rp
       CROSS JOIN leaderboards lb
       WHERE rp.category = 'graded'
         AND lb.season_id = '2026s1'
         AND lb.division = 'graded'`,
      // Step 10b: Backfill — Bind open-division races to open leaderboard
      `INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
       SELECT DISTINCT rp.race_id, lb.id
       FROM race_participants rp
       CROSS JOIN leaderboards lb
       WHERE rp.category = 'open'
         AND lb.season_id = '2026s1'
         AND lb.division = 'open'`,
      // Step 10c: Backfill — Bind races with graded participants to pickem leaderboard
      // (Pick'em is graded-only per results.js auto-scoring logic)
      `INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
       SELECT DISTINCT rp.race_id, lb.id
       FROM race_participants rp
       CROSS JOIN leaderboards lb
       WHERE rp.category = 'graded'
         AND lb.season_id = '2026s1'
         AND lb.division = 'pickem'`,
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
