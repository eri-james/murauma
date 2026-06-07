-- ============================================================
-- MURA Database Schema for Cloudflare D1 (SQLite)
-- ============================================================
-- Apply with: npx wrangler d1 execute murauma-db --file=./schema/001-initial.sql

-- Members table: stores registered community members
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(name) <= 50 AND length(name) > 0),
    trainer_id TEXT NOT NULL UNIQUE CHECK(length(trainer_id) = 12),
    favorite_uma TEXT NOT NULL CHECK(length(favorite_uma) <= 50 AND length(favorite_uma) > 0),
    bio TEXT NOT NULL CHECK(length(bio) <= 500 AND length(bio) > 0),
    profile_picture_data TEXT NOT NULL,  -- Base64-encoded image data
    profile_picture_mime TEXT NOT NULL DEFAULT 'image/jpeg',  -- MIME type, e.g. image/png
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Writings table: stores community-submitted stories and guides
CREATE TABLE IF NOT EXISTS writings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    author_name TEXT NOT NULL CHECK(length(author_name) <= 50 AND length(author_name) > 0),
    trainer_id TEXT NOT NULL CHECK(length(trainer_id) = 12),
    content TEXT NOT NULL CHECK(length(content) <= 50000 AND length(content) > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (trainer_id) REFERENCES members(trainer_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_members_trainer_id ON members(trainer_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_writings_created_at ON writings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_writings_trainer_id ON writings(trainer_id);
CREATE INDEX IF NOT EXISTS idx_writings_status ON writings(status);

-- Rate limit tracking table (replaces Google Apps Script CacheService)
CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_key TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_key)
);

-- Index for fast rate limit lookups and cleanup
CREATE INDEX IF NOT EXISTS idx_rate_limits_client_key ON rate_limits(client_key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);
