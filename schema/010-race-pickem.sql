-- ============================================================
-- Migration 010: Race Pick'em — Participants + Predictions
-- ============================================================
-- Adds participant rosters and member predictions for races.
-- This is the lightweight engagement precursor to the MURA Coins
-- betting system. No currency involved — just for fun and bragging rights.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/010-race-pickem.sql
-- ============================================================

-- Race participants: which members are racing in which race
CREATE TABLE IF NOT EXISTS race_participants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id     INTEGER NOT NULL,
    member_id   INTEGER NOT NULL,
    position    INTEGER DEFAULT NULL,  -- Finishing position (NULL until results entered)
    added_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (race_id) REFERENCES weekly_races(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE(race_id, member_id)        -- One entry per member per race
);

CREATE INDEX IF NOT EXISTS idx_race_participants_race ON race_participants(race_id);
CREATE INDEX IF NOT EXISTS idx_race_participants_member ON race_participants(member_id);

-- Race predictions: member picks for top 3 finishers
CREATE TABLE IF NOT EXISTS race_predictions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    race_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    pick_1st    INTEGER NOT NULL,      -- member_id predicted for 1st
    pick_2nd    INTEGER NOT NULL,      -- member_id predicted for 2nd
    pick_3rd    INTEGER NOT NULL,      -- member_id predicted for 3rd
    score       INTEGER DEFAULT NULL,  -- NULL until results are entered
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (race_id) REFERENCES weekly_races(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (pick_1st) REFERENCES members(id),
    FOREIGN KEY (pick_2nd) REFERENCES members(id),
    FOREIGN KEY (pick_3rd) REFERENCES members(id),
    UNIQUE(race_id, user_id)          -- One prediction per member per race
);

CREATE INDEX IF NOT EXISTS idx_race_predictions_race ON race_predictions(race_id);
CREATE INDEX IF NOT EXISTS idx_race_predictions_user ON race_predictions(user_id);
