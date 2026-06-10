-- ============================================================
-- Migration 009: Normalize hero_banner media_url
-- ============================================================
-- Fixes YouTube short URLs (youtu.be) and watch URLs to
-- use the proper /embed/ format required for iframe embedding.
--
-- Apply with:
--   npx wrangler d1 execute murauma-db --remote --file=./schema/009-hero-banner-normalize-url.sql
-- ============================================================

-- Fix youtu.be short URLs
UPDATE hero_banner
SET media_url = 'https://www.youtube.com/embed/' || SUBSTR(media_url, INSTR(media_url, 'youtu.be/') + 9, 11),
    updated_at = datetime('now')
WHERE media_type = 'youtube'
  AND media_url LIKE '%youtu.be/%'
  AND LENGTH(SUBSTR(media_url, INSTR(media_url, 'youtu.be/') + 9)) >= 11;

-- Fix youtube.com/watch?v= URLs
UPDATE hero_banner
SET media_url = 'https://www.youtube.com/embed/' || SUBSTR(media_url, INSTR(media_url, 'v=') + 2, 11),
    updated_at = datetime('now')
WHERE media_type = 'youtube'
  AND media_url LIKE '%youtube.com/watch%'
  AND media_url LIKE '%v=%'
  AND media_url NOT LIKE '%/embed/%';
