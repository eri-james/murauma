-- ============================================================
-- Migration 004: Fan Media table
-- ============================================================
-- Adds a single `fan_media` table for all member-submitted
-- fan content (art, video, music). Members share links only;
-- no file uploads. Admin approval required before appearing.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/004-fan-media.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS fan_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES members(id),
    type TEXT NOT NULL CHECK(type IN ('art', 'video', 'music')),
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    description TEXT CHECK(description IS NULL OR (length(description) <= 500 AND length(description) > 0)),
    url TEXT NOT NULL CHECK(length(url) <= 2000 AND length(url) > 0),
    author_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for filtering by type + status (gallery pages)
CREATE INDEX IF NOT EXISTS idx_fan_media_type_status ON fan_media(type, status);

-- Index for admin listing by status
CREATE INDEX IF NOT EXISTS idx_fan_media_status ON fan_media(status);

-- Index for user's own submissions
CREATE INDEX IF NOT EXISTS idx_fan_media_user_id ON fan_media(user_id);
