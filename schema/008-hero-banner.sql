-- ============================================================
-- Migration 008: Hero Banner
-- ============================================================
-- Adds a hero_banner table for admin-managed homepage banner.
-- Only one banner can be active at a time (is_active = 1).
-- Supports YouTube video embeds and image backgrounds.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/008-hero-banner.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS hero_banner (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    description TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT '' CHECK(length(link_url) <= 2000),
    media_type TEXT NOT NULL DEFAULT 'youtube' CHECK(media_type IN ('youtube', 'image')),
    media_url TEXT NOT NULL DEFAULT '' CHECK(length(media_url) <= 2000),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hero_banner_active ON hero_banner(is_active);

-- Seed: insert the current hardcoded banner as the first entry
INSERT INTO hero_banner (title, description, link_url, media_type, media_url, is_active)
VALUES (
    'Next Grand Event: The Merdeka Cup!',
    'Coming this August. Prepare your best horse girls!',
    'https://murauma.github.io/freedomcup/',
    'youtube',
    'https://www.youtube.com/embed/Y8AdCI95eCQ',
    1
);
