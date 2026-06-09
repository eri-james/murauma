-- ============================================================
-- Migration 007: Add slug and content columns to weekly_races
-- ============================================================
-- This migration brings weekly_races in line with events/news,
-- enabling slug-based URLs and rich HTML content for detailed
-- race pages (track info, strategies, categories, etc.).
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/007-weekly-races-slug-content.sql
-- ============================================================

-- Add slug column (nullable initially for backfill, then NOT NULL)
ALTER TABLE weekly_races ADD COLUMN slug TEXT;

-- Add content column for rich HTML body (Quill.js output)
ALTER TABLE weekly_races ADD COLUMN content TEXT NOT NULL DEFAULT '';

-- Backfill slugs for existing rows based on title
-- Generates URL-friendly slugs: lowercase, hyphens, alphanumeric only
UPDATE weekly_races SET slug = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
  TRIM(title),
  ' ', '-'), '_', '-'), '--', '-'), '--', '-'), '--', '-'))
WHERE slug IS NULL;

-- For any rows where slug is still empty, give them a fallback
UPDATE weekly_races SET slug = 'race-' || id
WHERE slug IS NULL OR slug = '';

-- Make slug NOT NULL and UNIQUE now that all rows are populated
-- Note: SQLite doesn't support ALTER COLUMN, so we create a new table
-- and copy data. This is the standard SQLite migration approach.

CREATE TABLE weekly_races_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    slug TEXT NOT NULL UNIQUE CHECK(length(slug) <= 120 AND length(slug) > 0),
    track TEXT NOT NULL CHECK(length(track) <= 200 AND length(track) > 0),
    deadline TEXT NOT NULL CHECK(length(deadline) <= 100 AND length(deadline) > 0),
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT CHECK(image_url IS NULL OR length(image_url) <= 2000),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO weekly_races_new (id, title, slug, track, deadline, description, content, image_url, is_active, status, created_at, updated_at)
SELECT id, title, slug, track, deadline, description, content, image_url, is_active, status, created_at, updated_at
FROM weekly_races;

DROP TABLE weekly_races;

ALTER TABLE weekly_races_new RENAME TO weekly_races;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_weekly_races_active ON weekly_races(is_active);
CREATE INDEX IF NOT EXISTS idx_weekly_races_status ON weekly_races(status);
CREATE INDEX IF NOT EXISTS idx_weekly_races_slug ON weekly_races(slug);
