-- ============================================================
-- Migration 002: Add status column to writings table
-- ============================================================
-- This enables the admin approval flow for writing submissions.
-- New writings default to 'pending' status.
-- Only 'approved' writings are shown on the public site.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/002-writings-status.sql

-- Add status column with default 'pending'
ALTER TABLE writings ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending', 'approved', 'rejected'));

-- Add index for fast status filtering
CREATE INDEX IF NOT EXISTS idx_writings_status ON writings(status);

-- Update any existing writings to 'approved' so they remain visible
-- (Run this only if you have existing writings that should stay visible)
-- UPDATE writings SET status = 'approved' WHERE status = 'pending';
