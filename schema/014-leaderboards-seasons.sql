-- ============================================================
-- Migration 014: Leaderboards & Seasons System
-- ============================================================
-- Adds admin-managed seasons, leaderboards, race-leaderboard
-- bindings, and immutable season archive snapshots.
--
-- This is the foundation for:
--   - Admin-managed season lifecycle (create, start, end, archive)
--   - Custom event leaderboards (Merdeka Cup, Freedom Cup, etc.)
--   - Many-to-many race ↔ leaderboard bindings
--   - Pick'em restricted to main weekly/biweekly seasons only
--   - Immutable archived season snapshots (DB-level immutability
--     via triggers)
--
-- Backfill behavior:
--   - Creates Season 1 2026 (id='2026s1', active, main, pickem ON)
--   - Creates 3 leaderboards for 2026s1 (open, graded, pickem)
--   - Sets season_id='2026s1' on all existing races (created >= 2026-06-01)
--   - Binds each existing race to the appropriate leaderboards:
--       * graded leaderboard if race has graded participants
--       * open leaderboard if race has open participants
--       * pickem leaderboard if race has graded participants (Pick'em is graded-only)
--   - Past Merdeka/Freedom Cup races stay in main seasonal standings
--     (no retroactive event leaderboard creation — only NEW event
--     leaderboards created after this migration will be separate)
--
-- Idempotency:
--   - CREATE TABLE/INDEX IF NOT EXISTS — safe to re-run
--   - DROP TRIGGER IF EXISTS before CREATE TRIGGER — safe to re-run
--   - INSERT OR IGNORE for backfills — safe to re-run
--   - UPDATE with WHERE season_id IS NULL — safe to re-run
--   - ALTER TABLE ADD COLUMN is NOT idempotent (will fail on 2nd run
--     if column exists). Mitigated by migration_log tracking.
--
-- Apply via: POST /api/admin/migrate (admin auth required)
-- ============================================================

-- ============================================================
-- STEP 1: Create seasons table
-- ============================================================
CREATE TABLE IF NOT EXISTS seasons (
    id              TEXT PRIMARY KEY,
    label           TEXT NOT NULL CHECK(length(label) <= 100 AND length(label) > 0),
    kind            TEXT NOT NULL DEFAULT 'main'
                    CHECK(kind IN ('main', 'event')),
    start_date      TEXT NOT NULL CHECK(length(start_date) <= 20 AND length(start_date) > 0),
    end_date        TEXT CHECK(end_date IS NULL OR (length(end_date) <= 20 AND length(end_date) > 0)),
    status          TEXT NOT NULL DEFAULT 'upcoming'
                    CHECK(status IN ('upcoming', 'active', 'ended', 'archived')),
    description      TEXT NOT NULL DEFAULT '',
    is_pickem_active INTEGER NOT NULL DEFAULT 0 CHECK(is_pickem_active IN (0, 1)),
    archived_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seasons_status ON seasons(status);
CREATE INDEX IF NOT EXISTS idx_seasons_kind ON seasons(kind);
CREATE INDEX IF NOT EXISTS idx_seasons_dates ON seasons(start_date, end_date);

-- ============================================================
-- STEP 2: Create leaderboards table
-- ============================================================
-- One row per (season, division). Division options:
--   'open'    — racer standings for open division
--   'graded'  — racer standings for graded division
--   'pickem'  — Pick'em prediction standings (main seasons only)
CREATE TABLE IF NOT EXISTS leaderboards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id       TEXT NOT NULL,
    division        TEXT NOT NULL CHECK(division IN ('open', 'graded', 'pickem')),
    display_name    TEXT NOT NULL DEFAULT '',
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    UNIQUE(season_id, division)
);

CREATE INDEX IF NOT EXISTS idx_leaderboards_season ON leaderboards(season_id);
CREATE INDEX IF NOT EXISTS idx_leaderboards_division ON leaderboards(division);

-- ============================================================
-- STEP 3: Create race_leaderboard_bindings junction table
-- ============================================================
-- Many-to-many: a race can feed multiple leaderboards (e.g., main
-- seasonal standings + Merdeka Cup event leaderboard).
CREATE TABLE IF NOT EXISTS race_leaderboard_bindings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id         INTEGER NOT NULL,
    leaderboard_id  INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (race_id) REFERENCES weekly_races(id) ON DELETE CASCADE,
    FOREIGN KEY (leaderboard_id) REFERENCES leaderboards(id) ON DELETE CASCADE,
    UNIQUE(race_id, leaderboard_id)
);

CREATE INDEX IF NOT EXISTS idx_bindings_race ON race_leaderboard_bindings(race_id);
CREATE INDEX IF NOT EXISTS idx_bindings_lb ON race_leaderboard_bindings(leaderboard_id);

-- ============================================================
-- STEP 4: Create season_archive_snapshots table (IMMUTABLE)
-- ============================================================
-- Stores the final standings for an archived season as a JSON blob.
-- Once is_locked=1, UPDATE and DELETE are rejected by DB triggers.
CREATE TABLE IF NOT EXISTS season_archive_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id           TEXT NOT NULL,
    division            TEXT NOT NULL CHECK(division IN ('open', 'graded', 'pickem')),
    snapshot_json       TEXT NOT NULL,
    snapshot_taken_at   TEXT NOT NULL DEFAULT (datetime('now')),
    is_locked           INTEGER NOT NULL DEFAULT 1 CHECK(is_locked IN (0, 1)),
    FOREIGN KEY (season_id) REFERENCES seasons(id)
);

CREATE INDEX IF NOT EXISTS idx_archive_season ON season_archive_snapshots(season_id);
CREATE INDEX IF NOT EXISTS idx_archive_division ON season_archive_snapshots(season_id, division);

-- ============================================================
-- STEP 5: Create immutability triggers on season_archive_snapshots
-- ============================================================
-- These triggers REJECT any UPDATE or DELETE on rows where
-- is_locked=1. Once a season is archived (snapshot taken with
-- is_locked=1), the snapshot cannot be modified via SQL — even
-- by direct DB access. To unlock a snapshot (e.g., to fix a
-- discovered bug), an admin must manually run:
--   UPDATE season_archive_snapshots SET is_locked=0 WHERE season_id='...';
-- This operational friction is intentional.
--
-- Note: SQLite triggers don't support IF NOT EXISTS, so we DROP first.

DROP TRIGGER IF EXISTS trg_archive_no_update;
CREATE TRIGGER trg_archive_no_update
BEFORE UPDATE ON season_archive_snapshots
WHEN OLD.is_locked = 1 AND NEW.is_locked = 1
BEGIN
    SELECT RAISE(ABORT, 'Archived season snapshots are immutable (is_locked=1). To modify, set is_locked=0 first via direct DB access.');
END;

DROP TRIGGER IF EXISTS trg_archive_no_delete;
CREATE TRIGGER trg_archive_no_delete
BEFORE DELETE ON season_archive_snapshots
WHEN OLD.is_locked = 1
BEGIN
    SELECT RAISE(ABORT, 'Archived season snapshots are immutable (is_locked=1). To delete, set is_locked=0 first via direct DB access.');
END;

-- ============================================================
-- STEP 6: Add season_id column to weekly_races (nullable)
-- ============================================================
-- NULL = "auto" (use the active main season at result-entry time).
-- Non-NULL = explicitly bound to a specific season.
-- Existing races will be backfilled to '2026s1' in step 8.
--
-- NOTE: ALTER TABLE ADD COLUMN is NOT idempotent. If this migration
-- runs partially and is re-run, this statement will fail. Mitigated
-- by migration_log tracking in the admin migrate endpoint.
ALTER TABLE weekly_races ADD COLUMN season_id TEXT;

-- ============================================================
-- STEP 7: Backfill — Create Season 1 2026
-- ============================================================
-- This replaces the hardcoded SEASONS constant in race-leaderboard/index.js.
INSERT OR IGNORE INTO seasons (id, label, kind, start_date, end_date, status, description, is_pickem_active)
VALUES ('2026s1', 'Season 1 2026', 'main', '2026-06-01', NULL, 'active', 'Inaugural MURA racing season (June 2026 onward). Includes Merdeka Cup and Freedom Cup races as part of the main standings.', 1);

-- ============================================================
-- STEP 8: Backfill — Create leaderboards for 2026s1
-- ============================================================
-- Pick'em is active for this main season, so we create all 3 divisions.
INSERT OR IGNORE INTO leaderboards (season_id, division, display_name, is_active)
VALUES ('2026s1', 'open', '', 1);

INSERT OR IGNORE INTO leaderboards (season_id, division, display_name, is_active)
VALUES ('2026s1', 'graded', '', 1);

INSERT OR IGNORE INTO leaderboards (season_id, division, display_name, is_active)
VALUES ('2026s1', 'pickem', '', 1);

-- ============================================================
-- STEP 9: Backfill — Set season_id on existing races
-- ============================================================
-- All existing races (created >= 2026-06-01) belong to Season 1 2026.
-- This includes past Merdeka Cup and Freedom Cup races — they stay
-- in the main seasonal standings per admin decision (2026-09-17).
-- No retroactive event leaderboard creation for past special-event races.
UPDATE weekly_races
SET season_id = '2026s1'
WHERE season_id IS NULL
  AND created_at >= '2026-06-01';

-- ============================================================
-- STEP 10: Backfill — Bind existing races to leaderboards
-- ============================================================
-- For each existing race, create bindings to the appropriate 2026s1
-- leaderboards based on which divisions have participants:
--   * graded leaderboard  ← races with at least 1 graded participant
--   * open leaderboard    ← races with at least 1 open participant
--   * pickem leaderboard  ← races with at least 1 graded participant
--                            (Pick'em is graded-only per results.js)
--
-- Uses INSERT OR IGNORE to be idempotent (UNIQUE(race_id, leaderboard_id)
-- constraint prevents duplicate bindings on re-run).

-- 10a: Bind graded-division races to graded leaderboard
INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
SELECT DISTINCT rp.race_id, lb.id
FROM race_participants rp
CROSS JOIN leaderboards lb
WHERE rp.category = 'graded'
  AND lb.season_id = '2026s1'
  AND lb.division = 'graded';

-- 10b: Bind open-division races to open leaderboard
INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
SELECT DISTINCT rp.race_id, lb.id
FROM race_participants rp
CROSS JOIN leaderboards lb
WHERE rp.category = 'open'
  AND lb.season_id = '2026s1'
  AND lb.division = 'open';

-- 10c: Bind races with graded participants to pickem leaderboard
-- (Pick'em only works for races with a graded division, per results.js)
INSERT OR IGNORE INTO race_leaderboard_bindings (race_id, leaderboard_id)
SELECT DISTINCT rp.race_id, lb.id
FROM race_participants rp
CROSS JOIN leaderboards lb
WHERE rp.category = 'graded'
  AND lb.season_id = '2026s1'
  AND lb.division = 'pickem';

-- ============================================================
-- END OF MIGRATION 014
-- ============================================================
-- Post-migration verification (run manually after applying):
--   SELECT * FROM seasons;
--   SELECT * FROM leaderboards;
--   SELECT COUNT(*) FROM race_leaderboard_bindings;
--   SELECT COUNT(*) FROM weekly_races WHERE season_id = '2026s1';
--   SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_archive%';
-- ============================================================
