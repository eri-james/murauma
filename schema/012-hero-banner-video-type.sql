-- ============================================================
-- Migration 012: Add 'video' media type to hero_banner
-- ============================================================
-- Extends the CHECK constraint on media_type to allow 'video'
-- for direct video file URLs (e.g. catbox.moe .mp4 links).
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/012-hero-banner-video-type.sql
-- ============================================================

-- SQLite does not support ALTER TABLE ... ALTER CONSTRAINT, so we must recreate the table.
-- Step 1: Create new table with updated constraint
CREATE TABLE IF NOT EXISTS hero_banner_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    description TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT '' CHECK(length(link_url) <= 2000),
    media_type TEXT NOT NULL DEFAULT 'youtube' CHECK(media_type IN ('youtube', 'image', 'video')),
    media_url TEXT NOT NULL DEFAULT '' CHECK(length(media_url) <= 2000),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy existing data
INSERT INTO hero_banner_new (id, title, description, link_url, media_type, media_url, is_active, created_at, updated_at)
SELECT id, title, description, link_url, media_type, media_url, is_active, created_at, updated_at
FROM hero_banner;

-- Step 3: Drop old table
DROP TABLE hero_banner;

-- Step 4: Rename new table
ALTER TABLE hero_banner_new RENAME TO hero_banner;

-- Step 5: Recreate index
CREATE INDEX IF NOT EXISTS idx_hero_banner_active ON hero_banner(is_active);
