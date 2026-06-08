-- ============================================================
-- Migration 006: Dynamic Content (Weekly Races, Events, News)
-- ============================================================
-- Adds tables for admin-managed dynamic content that replaces
-- the hardcoded sections on the homepage.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/006-dynamic-content.sql
-- ============================================================

-- Weekly Races: displayed on the homepage
CREATE TABLE IF NOT EXISTS weekly_races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    track TEXT NOT NULL CHECK(length(track) <= 200 AND length(track) > 0),
    deadline TEXT NOT NULL CHECK(length(deadline) <= 100 AND length(deadline) > 0),
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT CHECK(image_url IS NULL OR length(image_url) <= 2000),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_races_active ON weekly_races(is_active);
CREATE INDEX IF NOT EXISTS idx_weekly_races_status ON weekly_races(status);

-- Events: featured events on homepage + event detail pages
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    slug TEXT NOT NULL UNIQUE CHECK(length(slug) <= 120 AND length(slug) > 0),
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT CHECK(image_url IS NULL OR length(image_url) <= 2000),
    start_date TEXT NOT NULL CHECK(length(start_date) <= 50 AND length(start_date) > 0),
    end_date TEXT CHECK(end_date IS NULL OR length(end_date) <= 50),
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);

-- News: news posts on homepage + detail pages
CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    slug TEXT NOT NULL UNIQUE CHECK(length(slug) <= 120 AND length(slug) > 0),
    category TEXT NOT NULL DEFAULT 'community' CHECK(category IN ('event', 'community', 'update')),
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    image_url TEXT CHECK(image_url IS NULL OR length(image_url) <= 2000),
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_news_slug ON news(slug);
CREATE INDEX IF NOT EXISTS idx_news_status ON news(status);
CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON news(created_at);
