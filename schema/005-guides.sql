-- ============================================================
-- Migration 005: Guides + Guide Votes
-- ============================================================
-- Adds the `guides` table for member-written game guides
-- (rich HTML content stored in D1, served dynamically) and
-- the `guide_votes` table for Reddit-style upvote/downvote.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/005-guides.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS guides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES members(id),
    title TEXT NOT NULL CHECK(length(title) <= 200 AND length(title) > 0),
    slug TEXT NOT NULL UNIQUE CHECK(length(slug) <= 120 AND length(slug) > 0),
    content TEXT NOT NULL CHECK(length(content) > 0),
    author_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for slug lookups (already unique, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_guides_slug ON guides(slug);

-- Index for filtering by status (admin listing)
CREATE INDEX IF NOT EXISTS idx_guides_status ON guides(status);

-- Index for user's own guides
CREATE INDEX IF NOT EXISTS idx_guides_user_id ON guides(user_id);

-- Guide votes table (Reddit-style upvote/downvote)
CREATE TABLE IF NOT EXISTS guide_votes (
    user_id INTEGER NOT NULL REFERENCES members(id),
    guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
    vote INTEGER NOT NULL CHECK(vote IN (1, -1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, guide_id)
);

-- Index for computing vote totals
CREATE INDEX IF NOT EXISTS idx_guide_votes_guide_id ON guide_votes(guide_id);
