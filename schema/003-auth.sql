-- ============================================================
-- Migration 003: Add authentication system
-- ============================================================
-- Adds username/password login, makes trainer_id optional,
-- adds user_id to writings, and adds role column for RBAC.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/003-auth.sql
--
-- IMPORTANT: This migration recreates the members table.
-- Existing data is preserved. Legacy members (those who
-- registered before this migration) will have username=NULL
-- and must use /setup-account.html to claim their account.
-- ============================================================

-- Step 1: Create new members table with auth columns
CREATE TABLE IF NOT EXISTS members_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE CHECK(username IS NULL OR (length(username) >= 3 AND length(username) <= 30)),
    password_hash TEXT,
    password_salt TEXT,
    name TEXT NOT NULL CHECK(length(name) <= 50 AND length(name) > 0),
    trainer_id TEXT UNIQUE CHECK(trainer_id IS NULL OR length(trainer_id) = 12),
    favorite_uma TEXT CHECK(favorite_uma IS NULL OR (length(favorite_uma) <= 50 AND length(favorite_uma) > 0)),
    bio TEXT CHECK(bio IS NULL OR (length(bio) <= 500 AND length(bio) > 0)),
    profile_picture_data TEXT NOT NULL,
    profile_picture_mime TEXT NOT NULL DEFAULT 'image/jpeg',
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy existing data into the new table
-- Legacy users get username=NULL and role='member'
INSERT INTO members_new (name, trainer_id, favorite_uma, bio, profile_picture_data, profile_picture_mime, role, status, created_at)
SELECT
    name,
    trainer_id,
    favorite_uma,
    bio,
    profile_picture_data,
    profile_picture_mime,
    'member',
    status,
    created_at
FROM members;

-- Step 3: Drop old table
DROP TABLE members;

-- Step 4: Rename new table
ALTER TABLE members_new RENAME TO members;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_members_trainer_id ON members(trainer_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_members_username ON members(username);

-- Step 6: Add user_id column to writings table
-- This links writings to the members table by numeric ID
-- (supplements the existing trainer_id FK for users without a trainer_id)
ALTER TABLE writings ADD COLUMN user_id INTEGER REFERENCES members(id);

-- Step 7: Backfill user_id for existing writings
UPDATE writings SET user_id = (
    SELECT id FROM members WHERE members.trainer_id = writings.trainer_id
) WHERE trainer_id IS NOT NULL AND user_id IS NULL;

-- Step 8: Index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_writings_user_id ON writings(user_id);
