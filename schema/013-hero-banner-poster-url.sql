-- ============================================================
-- Migration 013: Add poster_url to hero_banner
-- ============================================================
-- Adds a poster_url column for a fallback image shown when
-- video media can't load (e.g. catbox.moe blocked by ISP).
-- If empty, the frontend falls back to the default MURA banner.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/013-hero-banner-poster-url.sql
-- ============================================================

ALTER TABLE hero_banner ADD COLUMN poster_url TEXT NOT NULL DEFAULT '' CHECK(length(poster_url) <= 2000);
