-- ============================================================
-- Migration 011: Race Categories (Open & Graded Divisions)
-- ============================================================
-- Adds a 'category' column to race_participants so members can
-- join either Open (A+ rank and below) or Graded (no rank limit),
-- or both. The UNIQUE constraint changes from (race_id, member_id)
-- to (race_id, member_id, category) to allow one entry per category.
--
-- Pick'em predictions only consider graded participants.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/011-race-category.sql
-- ============================================================

-- SQLite doesn't support ALTER COLUMN, so we rebuild the table.

-- Step 1: Create new table with updated schema
CREATE TABLE IF NOT EXISTS race_participants_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id     INTEGER NOT NULL,
    member_id   INTEGER NOT NULL,
    category    TEXT NOT NULL DEFAULT 'graded' CHECK(category IN ('open', 'graded')),
    position    INTEGER DEFAULT NULL,
    added_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (race_id) REFERENCES weekly_races(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE(race_id, member_id, category)
);

-- Step 2: Copy existing data (all existing participants become 'graded')
INSERT INTO race_participants_new (id, race_id, member_id, category, position, added_at)
SELECT id, race_id, member_id, 'graded', position, added_at FROM race_participants;

-- Step 3: Drop old table
DROP TABLE race_participants;

-- Step 4: Rename new table
ALTER TABLE race_participants_new RENAME TO race_participants;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_race_participants_race ON race_participants(race_id);
CREATE INDEX IF NOT EXISTS idx_race_participants_member ON race_participants(member_id);
CREATE INDEX IF NOT EXISTS idx_race_participants_category ON race_participants(race_id, category);
