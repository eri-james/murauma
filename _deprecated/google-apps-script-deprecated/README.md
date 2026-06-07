# Archived: Google Apps Script Backend

This directory contains the **deprecated** Google Apps Script backend that was originally used for MURA.

## Why it was replaced

The site has been migrated to **Cloudflare Pages + Workers + D1**, which provides:
- Edge-fast responses (no 2-5s cold starts)
- Proper IP-based rate limiting (Apps Script couldn't see client IPs)
- All-in-one dashboard (Pages, Workers, D1 under one account)
- Auto-deploy via `git push`
- Secrets stored as Worker environment variables (not in repo code)

## The replacement

The new backend lives in `/functions/` at the repo root:
- `functions/api/register.js` — replaces `handleMemberRegistration()`
- `functions/api/submit.js` — replaces `handleWritingSubmission()`
- `functions/api/writings.js` — replaces `handleListWritings()`
- `functions/api/members.js` — lists approved members
- `functions/api/avatar/[[key]].js` — serves profile pictures from D1
- `functions/api/admin/members.js` — admin: approve/reject members
- `functions/api/admin/writings.js` — admin: approve/reject/delete writings
- `functions/_shared/utils.js` — shared sanitization, rate limiting, hCaptcha

## If you need to roll back

1. Redeploy the `.gs` file to script.google.com
2. Revert the HTML files to use the Apps Script URLs
3. The original URLs are in the git history
