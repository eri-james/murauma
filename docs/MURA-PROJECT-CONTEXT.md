# MURA Project — Full Context Document

> **Last Updated**: 2026-09-17
> **Purpose**: Complete backup of project knowledge for context transfer to other AI agents/tools
> **Project**: Malayan Umamusume Racing Association (MURA) Community Site
> **Current HEAD**: `5ff9cc7` — Phase 4 of leaderboard system redesign shipped

---

## Table of Contents

0. [Current State Summary (NEW — start here)](#0-current-state-summary)
1. [Project Overview](#1-project-overview)
2. [Tech Stack & Architecture](#2-tech-stack--architecture)
3. [Repository Structure](#3-repository-structure)
4. [Database Schema](#4-database-schema)
5. [API Endpoints](#5-api-endpoints)
6. [Frontend Pages](#6-frontend-pages)
7. [Navigation System](#7-navigation-system)
8. [Authentication System](#8-authentication-system)
9. [Build System](#9-build-system)
10. [Current Known Issues](#10-current-known-issues)
11. [Git History & Key Commits](#11-git-history--key-commits)
12. [Feature Plans](#12-feature-plans)
13. [Development Patterns & Conventions](#13-development-patterns--conventions)
14. [Deployment](#14-deployment)
15. [Outstanding TODO Items](#15-outstanding-todo-items)

---

## 0. Current State Summary

> **Read this section first** — it's the freshest snapshot of the project. Other sections may have stale details; this one reflects reality as of the last update.

### Recent major work — Leaderboard System Redesign (Phases 1-4, complete)

The leaderboard system was redesigned from a hardcoded single-season JS constant into a full admin-managed seasons + leaderboards + immutable archives system. **9 commits shipped September 2026:**

| Commit | Description |
|---|---|
| `e744f8a` | Phase 1 — SQL migration 014 (4 new tables, 2 immutability triggers, backfill Season 1 2026) |
| `f83dd2f` | Phase 2.1 — Public read endpoints (`/api/seasons`, `/api/archive`, `/api/archive/<id>`) |
| `b2cc31b` | Phase 2.2 — Admin seasons CRUD (`/api/admin/seasons` GET/POST/PATCH with status transitions) |
| `7c57bc7` | Phase 2.3 — Admin archive endpoint + standings preview |
| `95ff031` | Phase 2.4 — Race-leaderboard bindings endpoint + auto-bind on race creation |
| `d60c74d` | Phase 2.5 — Refactored `/api/race-leaderboard` to be DB-driven (removed hardcoded SEASONS constant) |
| `d9bc2a1` | Phase 2.6 — Refactored Pick'em leaderboard + added binding check |
| `37e8712` | Phase 3 — Admin UI (Seasons + Leaderboards + Archive sections in admin/index.html + race binding field) |
| `a93a598` | Tailwind rebuild (added sky/slate/indigo/amber colors used by Phase 3 UI) |
| `55ce2f1` | Fixed import path bug in race-leaderboard/index.js that broke Cloudflare build |
| `5ff9cc7` | Phase 4 — Public UI (dynamic season dropdowns on race-leaderboard.html, pickem-leaderboard.html, new archive.html) |

**Key concepts to know:**
- **Seasons** are admin-managed entities (id, label, kind=main/event, start/end dates, status: upcoming → active → ended → archived)
- **Leaderboards** are auto-created per season (open, graded divisions always; pickem only for main seasons with `is_pickem_active=1`)
- **Races bind to leaderboards** via many-to-many `race_leaderboard_bindings` (a race can feed both the main seasonal standings AND an event leaderboard)
- **Archived seasons are immutable** — DB-level triggers (`trg_archive_no_update`, `trg_archive_no_delete`) reject UPDATE/DELETE on snapshot rows
- **Pick'em is restricted to main seasons** — event leaderboards never have pickem divisions
- **All-Time standings are unaffected by archiving** — underlying race data is preserved, only the per-season view is frozen
- **Past Merdeka/Freedom Cup races remain in main seasonal standings** — no retroactive re-binding was done

### Project state at a glance

- **Live site**: https://murauma.pages.dev — fully functional
- **Admin UI**: https://murauma.pages.dev/admin/ — Seasons, Boards, Archive sections all working
- **Public pages**: All leaderboard pages now have dynamic season dropdowns
- **DB migrations applied**: 001-014 (migration 014 = leaderboard system, applied September 2026)
- **D1 database**: `murauma-db` (ID: `4919fadc-6878-4b79-a885-853f388bb31c`)
- **Cloudflare Pages auto-deploys** on push to `main` branch

### What's working well
- All 21 user-facing HTML pages render correctly
- Auth system (JWT in httpOnly cookie) works
- Admin UI is comprehensive (members, writings, fan-media, guides, races, events, news, seasons, leaderboards, archive, hero-banner, migrations)
- Pick'em system works for main weekly/biweekly seasons
- Race results entry auto-scores Pick'em predictions
- Migration system is idempotent and tested

### What's intentionally deferred (low priority)
- **MURA Coins** — virtual currency system. Decision (Sept 2026): on hold indefinitely. User base is <20 people; most visit for race info, news, and standings only. Adding coin economy would add complexity without visible value.
- **Phase 5 leaderboard enhancements** — standalone `leaderboard.html` page, Hall of Fame view, auto-archive cron job, MURA Coins integration. All judged "nice-to-have" / over-engineering at current scale.
- **Build-time debloat completion** — 95% done, remaining 5% is dead-code cleanup. See §9 for details.

### Known minor issues (non-blocking)
- `js/layout.js` is orphaned (no HTML page references it) but the file still exists — safe to delete
- `js/auth.js` has a dead `mura:layout-ready` event listener (line ~145) — never fires since nothing dispatches the event
- Avatar API returns broken images for some members (pre-existing, not a regression)
- imgbb hotlink protection may block some images on `about.html` (pre-existing)

### Outstanding high-value TODOs (not started)
1. **Commit this `MURA-PROJECT-CONTEXT.md` to git** — currently untracked in repo root
2. **Build-time debloat completion** — see §9 for the 3 small steps remaining
3. **Real-world testing of leaderboard system** — actually create a test event, end a season, archive it
4. (Deferred) MURA Coins Phase 1 — only if community engagement grows significantly

---

## 1. Project Overview

**MURA** (Malayan Umamusume Racing Association) is a fan community site for players of *Umamusume: Pretty Derby* (a game by Cygames) in Malaysia and Singapore. The site serves as a hub for:

- **Weekly/Biweekly race events** — members sign up, race in-game, and results are tracked
- **Pick'em predictions** — members predict top 3 finishers for each race
- **Racer leaderboard** — seasonal and all-time rankings based on race results
- **Community content** — fan art, videos, writings, music, game guides
- **News & events** — admin-managed dynamic content
- **Hero banner** — rotating homepage banner (supports YouTube, image, and video media types)

The community is managed by a solo admin who is also the race host and a participant.

**Live URL**: https://murauma.pages.dev  
**Repository**: `/home/z/my-project/murauma-repo/`

---

## 2. Tech Stack & Architecture

### Frontend
- **Pure HTML/CSS/JS** — no framework (vanilla)
- **Tailwind CSS 3.x** — built via `npm run build:css` → `css/tailwind.min.css`
- **Custom CSS** — `css/common.css` for nav, overlay, animations, particle canvas
- **Self-hosted fonts** — Inter (Regular, Bold, Black) in `/fonts/`
- **DOMPurify** — CDN + fallback for HTML sanitization
- **Canvas particles** — `js/particles.js` creates floating network-particle background

### Backend
- **Cloudflare Pages Functions** — serverless API at `/functions/api/`
- **Cloudflare D1** — SQLite database (binding: `DB`, database: `murauma-db`)
- **Auth**: JWT (HS256) stored in httpOnly cookie `mura_session`, 7-day expiry
- **Password hashing**: PBKDF2 (100,000 iterations, 256-bit key)
- **Rate limiting**: D1-based `rate_limits` table (3 requests per 10-minute window)

### Key Architectural Decisions
- No SSR — all pages are static HTML with client-side JS fetching data from API
- Admin panel is a single-page app at `/admin/index.html` (2632 lines)
- Navigation/footer/overlay are currently **duplicated across all HTML pages** (the debloat effort is trying to fix this)
- The `build.js` system exists but has not been fully transitioned to — current pages use a mix of inline HTML, `layout.js` runtime includes, and `build.js` marker-based replacement

---

## 3. Repository Structure

```
murauma-repo/
├── index.html                    # Homepage (1236 lines)
├── weekly-race.html              # Race detail + listing page (1330 lines)
├── about.html                    # About MURA page (399 lines)
├── guides.html                   # Guide listing (226 lines)
├── guide.html                    # Individual guide page (302 lines)
├── login.html                    # Login page (218 lines)
├── register.html                 # Registration page (377 lines)
├── edit-profile.html             # Profile editor (391 lines)
├── setup-account.html            # Legacy account setup (258 lines)
├── news-detail.html              # News detail page (253 lines)
├── event-detail.html             # Event detail page (262 lines)
├── submit-writing.html           # Writing submission (290 lines)
├── submit-fan-media.html         # Fan media submission (329 lines)
├── write-guide.html              # Guide creation (381 lines)
├── race-leaderboard.html         # Racer leaderboard (714 lines)
├── pickem-leaderboard.html       # Pick'em predictor leaderboard (186 lines)
├── not_found.html                # 404 page (27 lines)
│
├── fan-media/
│   ├── fanart.html               # Fan art gallery (340 lines)
│   ├── videos.html               # Video gallery (261 lines)
│   ├── writings.html             # Writings gallery (281 lines)
│   └── music.html                # Music gallery (291 lines)
│
├── admin/
│   └── index.html                # Admin panel SPA (2632 lines)
│
├── includes/                     # Nav/footer/overlay templates
│   ├── nav.html                  # Sub-page nav ({{NAVLINK_PREFIX}} vars)
│   ├── nav-home.html             # Homepage nav (hardcoded # anchors + about.html + Races link)
│   ├── nav-sub.html              # Fan-media nav (../relative paths)
│   ├── overlay.html              # Mobile overlay menu ({{NAVLINK_PREFIX}} vars)
│   ├── footer.html               # Footer (root pages)
│   └── footer-sub.html           # Footer (sub-pages, uses &ndash;)
│
├── js/
│   ├── auth.js                   # Client-side auth (checks /api/me, updates nav)
│   ├── layout.js                 # Runtime nav/footer fetcher (PROBLEMATIC — causes race conditions)
│   ├── nav-overlay.js            # Burger menu overlay toggle
│   ├── dompurify-fallback.js     # Text-only sanitizer if CDN fails
│   └── particles.js              # Canvas particle background
│
├── css/
│   ├── tailwind.min.css          # Built Tailwind (production)
│   ├── tailwind-src.css          # Tailwind source (directives)
│   ├── common.css                # Shared styles (nav, overlay, animations)
│   └── fonts.css                 # Font-face declarations
│
├── functions/
│   ├── _shared/
│   │   └── utils.js              # 1030 lines — auth, JWT, PBKDF2, rate limiting, response helpers
│   └── api/                      # All API endpoints (see Section 5)
│       ├── me.js                 # Current user info
│       ├── login.js              # Login
│       ├── register.js           # Registration (262 lines)
│       ├── logout.js             # Logout
│       ├── hero-banner.js        # Public hero banner
│       ├── weekly-races.js       # Race listing/detail
│       ├── events.js             # Events listing/detail
│       ├── news.js               # News listing/detail
│       ├── members.js            # Member listing
│       ├── members/profile.js    # Public member profile
│       ├── writings.js           # Writings listing
│       ├── submit.js             # Submit writing
│       ├── guides/               # Guide-related endpoints
│       ├── fan-media/            # Fan media endpoints
│       ├── youtube-feed.js       # YouTube RSS feed
│       ├── setup-account.js      # Legacy account setup
│       ├── avatar/[[key]].js     # Avatar serving
│       ├── race-participants/    # Join/leave race
│       ├── race-predictions/     # Pick'em system
│       ├── race-leaderboard/     # Racer leaderboard
│       └── admin/                # All admin endpoints
│
├── schema/                       # D1 migration files
│   ├── 001-initial.sql           # Members, writings, rate_limits
│   ├── 002-writings-status.sql   # Writings status column
│   ├── 003-auth.sql              # Auth system (username, password, role)
│   ├── 004-fan-media.sql         # Fan media table
│   ├── 005-guides.sql            # Guides + guide_votes
│   ├── 006-dynamic-content.sql   # weekly_races, events, news
│   ├── 007-weekly-races-slug-content.sql  # Slug + content for races
│   ├── 008-hero-banner.sql       # Hero banner table
│   ├── 009-hero-banner-normalize-url.sql  # URL normalization
│   ├── 010-race-pickem.sql       # Race participants + predictions
│   ├── 011-race-category.sql     # Open & Graded divisions
│   ├── 012-hero-banner-video-type.sql     # Video media type
│   └── 013-hero-banner-poster-url.sql     # Poster URL for video
│
├── docs/
│   ├── mura-coins-plan.md        # Virtual currency plan (not yet implemented)
│   ├── self-join-auto-approve-plan.md  # Self-join & auto-approve (IMPLEMENTED)
│   └── racer-leaderboard-plan.md # Racer leaderboard (IMPLEMENTED)
│
├── _content-archive/             # Archived static content (pre-dynamic)
├── _deprecated/                  # Old templates, Google Apps Script code
├── fonts/                        # Self-hosted Inter web fonts
├── build.js                      # Build script for nav/footer includes (marker-based)
├── wrangler.toml                 # Cloudflare config (D1 binding)
├── package.json                  # Node config (Tailwind build scripts)
├── tailwind.config.js            # Tailwind config (content paths)
├── postcss.config.js             # PostCSS config
├── _headers                      # Cloudflare Pages headers (caching rules)
├── sitemap.xml                   # SEO sitemap
├── robots.txt                    # SEO robots
├── favicon.ico                   # Favicon
└── favicon.png                   # Apple touch icon
```

---

## 4. Database Schema

### D1 Database: `murauma-db`
- **Binding**: `DB` (accessed via `context.env.DB`)
- **Database ID**: `4919fadc-6878-4b79-a885-853f388bb31c`

### Tables

#### `members`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| username | TEXT UNIQUE | 3-30 chars, nullable (legacy users) |
| password_hash | TEXT | PBKDF2 |
| password_salt | TEXT | |
| name | TEXT NOT NULL | Max 50 chars |
| trainer_id | TEXT UNIQUE | 12-digit in-game ID, nullable |
| favorite_uma | TEXT | Max 50 chars, nullable |
| bio | TEXT | Max 500 chars, nullable |
| profile_picture_data | TEXT NOT NULL | Base64-encoded |
| profile_picture_mime | TEXT | Default 'image/jpeg' |
| role | TEXT | 'member' or 'admin', default 'member' |
| status | TEXT | 'pending', 'approved', 'rejected', default 'pending' |
| created_at | TEXT | ISO datetime |

#### `writings`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| title | TEXT NOT NULL | Max 200 chars |
| author_name | TEXT NOT NULL | Max 50 chars |
| trainer_id | TEXT | Max 12 chars |
| content | TEXT NOT NULL | Max 50000 chars |
| user_id | INTEGER FK | → members.id |
| status | TEXT | 'pending', 'approved', 'rejected', default 'pending' |
| created_at | TEXT | |

#### `guides`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| user_id | INTEGER FK NOT NULL | → members.id |
| title | TEXT NOT NULL | Max 200 chars |
| slug | TEXT UNIQUE NOT NULL | Max 120 chars |
| content | TEXT NOT NULL | Rich HTML |
| author_name | TEXT | |
| status | TEXT | 'pending', 'approved', 'rejected' |
| created_at / updated_at | TEXT | |

#### `guide_votes`
| Column | Type | Notes |
|--------|------|-------|
| user_id | INTEGER FK | → members.id |
| guide_id | INTEGER FK | → guides.id ON DELETE CASCADE |
| vote | INTEGER | 1 or -1 |
| PK | (user_id, guide_id) | |

#### `weekly_races`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| title | TEXT NOT NULL | Max 200 chars |
| slug | TEXT UNIQUE NOT NULL | Max 120 chars |
| track | TEXT NOT NULL | Max 200 chars |
| deadline | TEXT NOT NULL | Max 100 chars |
| description | TEXT | |
| content | TEXT | Rich HTML (Quill.js output) |
| image_url | TEXT | Max 2000 chars |
| is_active | INTEGER | 0 or 1, default 1 |
| status | TEXT | 'draft' or 'published', default 'published' |
| created_at / updated_at | TEXT | |

#### `events`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| title | TEXT NOT NULL | Max 200 chars |
| slug | TEXT UNIQUE NOT NULL | Max 120 chars |
| description / content | TEXT | |
| image_url | TEXT | |
| start_date | TEXT NOT NULL | |
| end_date | TEXT | Nullable |
| status | TEXT | 'draft' or 'published' |
| created_at / updated_at | TEXT | |

#### `news`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| title | TEXT NOT NULL | Max 200 chars |
| slug | TEXT UNIQUE NOT NULL | Max 120 chars |
| category | TEXT | 'event', 'community', 'update', default 'community' |
| description / content | TEXT | |
| image_url | TEXT | |
| status | TEXT | 'draft' or 'published' |
| created_at / updated_at | TEXT | |

#### `hero_banner`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| title | TEXT NOT NULL | Max 200 chars |
| description | TEXT | |
| link_url | TEXT | Max 2000 chars |
| media_type | TEXT | 'youtube', 'image', 'video' |
| media_url | TEXT | Max 2000 chars |
| poster_url | TEXT | Fallback image for video type |
| is_active | INTEGER | 0 or 1, only one active at a time |
| created_at / updated_at | TEXT | |

#### `fan_media`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| title | TEXT | Max 200 chars |
| media_type | TEXT | 'image', 'video', 'writing', 'music' |
| url | TEXT | |
| author_name | TEXT | |
| description | TEXT | |
| status | TEXT | 'pending', 'approved', 'rejected' |
| created_at | TEXT | |

#### `race_participants`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| race_id | INTEGER FK | → weekly_races(id) ON DELETE CASCADE |
| member_id | INTEGER FK | → members(id) ON DELETE CASCADE |
| category | TEXT | 'open' or 'graded', default 'graded' |
| position | INTEGER | NULL until results entered |
| added_at | TEXT | |
| UNIQUE | (race_id, member_id, category) | |

#### `race_predictions`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| race_id | INTEGER FK | → weekly_races(id) |
| user_id | INTEGER FK | → members(id) |
| pick_1st / pick_2nd / pick_3rd | INTEGER FK | → members(id) |
| score | INTEGER | NULL until results |
| created_at / updated_at | TEXT | |
| UNIQUE | (race_id, user_id) | |

#### `rate_limits`
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| client_key | TEXT UNIQUE | |
| request_count | INTEGER | Default 1 |
| window_start | TEXT | |

#### `seasons` (Migration 014, September 2026)
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | e.g. '2026s1', 'merdeka-2027'. 3-30 chars, lowercase alphanumeric + hyphens |
| label | TEXT NOT NULL | Display name, e.g. 'Season 1 2026' |
| kind | TEXT | 'main' (weekly/biweekly) or 'event' (custom leaderboard) |
| start_date | TEXT | ISO YYYY-MM-DD, admin-defined |
| end_date | TEXT | NULL = ongoing |
| status | TEXT | 'upcoming' → 'active' → 'ended' → 'archived' (one-way transitions) |
| description | TEXT | Optional, shown on archive page |
| is_pickem_active | INTEGER | 0 or 1. Forced to 0 for kind='event' (Pick'em is main-only) |
| archived_at | TEXT | NULL until status='archived' set |
| created_at / updated_at | TEXT | |

#### `leaderboards` (Migration 014, September 2026)
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| season_id | TEXT FK | → seasons(id) ON DELETE CASCADE |
| division | TEXT | 'open', 'graded', or 'pickem' |
| display_name | TEXT | Optional override label |
| is_active | INTEGER | 0 or 1 |
| created_at | TEXT | |
| UNIQUE | (season_id, division) | One leaderboard per division per season |

**Auto-creation rule** (API-enforced):
- `kind='main'` + `is_pickem_active=1` → creates open, graded, pickem (3 leaderboards)
- `kind='main'` + `is_pickem_active=0` → creates open, graded (2 leaderboards)
- `kind='event'` (any pickem flag, ignored) → creates open, graded (2 leaderboards, no pickem)

#### `race_leaderboard_bindings` (Migration 014, September 2026)
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| race_id | INTEGER FK | → weekly_races(id) ON DELETE CASCADE |
| leaderboard_id | INTEGER FK | → leaderboards(id) ON DELETE CASCADE |
| created_at | TEXT | |
| UNIQUE | (race_id, leaderboard_id) | Prevents double-binding |

Many-to-many junction. A race can feed multiple leaderboards (e.g., main seasonal standings AND an event leaderboard). New races auto-bind to active main season leaderboards on creation.

#### `season_archive_snapshots` (Migration 014, September 2026)
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK AUTO | |
| season_id | TEXT FK | → seasons(id) |
| division | TEXT | 'open', 'graded', or 'pickem' |
| snapshot_json | TEXT | JSON blob containing full leaderboard at moment of archival |
| snapshot_taken_at | TEXT | When snapshot was taken |
| is_locked | INTEGER | 0 or 1. Default 1. When 1, DB triggers REJECT UPDATE/DELETE. |

**Immutability triggers**:
- `trg_archive_no_update` — BEFORE UPDATE, ABORTs if `OLD.is_locked=1 AND NEW.is_locked=1`
- `trg_archive_no_delete` — BEFORE DELETE, ABORTs if `OLD.is_locked=1`

To "unlock" a snapshot (escape hatch for fixing bugs), an admin with direct DB access must manually `UPDATE season_archive_snapshots SET is_locked=0 WHERE season_id=...` first. This operational friction is intentional.

#### `weekly_races` — Added column (Migration 014, September 2026)
| Column | Type | Notes |
|--------|------|-------|
| season_id | TEXT | Nullable. NULL = auto-resolve to active main season at race creation time. Non-NULL = explicitly bound to a specific season. |

---

## 5. API Endpoints

All endpoints are Cloudflare Pages Functions under `/functions/api/`.  
Base URL: `https://murauma.pages.dev/api/`

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/me` | Current user info (or 401) |
| POST | `/api/login` | Login (username + password) |
| POST | `/api/register` | Register (with hCaptcha) |
| POST | `/api/logout` | Clear session cookie |
| GET | `/api/hero-banner` | Active hero banner |
| GET | `/api/weekly-races` | List published races (`?slug=`, `?id=`, `?scope=all`) |
| GET | `/api/events` | List events (`?slug=`) |
| GET | `/api/news` | List news (`?slug=`) |
| GET | `/api/members` | List approved members |
| GET | `/api/members/profile?username=` | Public member profile |
| GET | `/api/writings` | List approved writings |
| POST | `/api/submit` | Submit a writing |
| GET | `/api/guides` | List approved guides (`?slug=`, `?sort=`) |
| POST | `/api/guides/submit` | Submit a guide |
| POST | `/api/guides/vote` | Vote on a guide (1 or -1) |
| GET | `/api/fan-media` | List approved fan media (`?type=`) |
| POST | `/api/fan-media/submit` | Submit fan media |
| GET | `/api/youtube-feed` | YouTube RSS feed |
| POST | `/api/race-participants/join` | Self-join a race |
| POST | `/api/race-participants/leave` | Leave a race |
| GET | `/api/race-predictions?raceId=` | Predictions for a race |
| POST | `/api/race-predictions` | Submit prediction (now validates pickem binding) |
| GET | `/api/race-predictions/mine?raceId=` | Current user's prediction |
| GET | `/api/race-predictions/leaderboard` | Pick'em leaderboard (`?season=`, `?leaderboardId=`, `?allTime=true`) — main seasons only |
| GET | `/api/race-leaderboard` | Racer leaderboard (`?season=`, `?leaderboardId=`, `?allTime=`, `?category=`) |
| GET | `/api/race-leaderboard/member?memberId=` | Racer detail (accepts `?season=` param) |
| GET | `/api/avatar/:key` | Member avatar image |
| POST | `/api/setup-account` | Legacy account claim |
| **GET** | **`/api/seasons`** | **(NEW)** List all seasons with their leaderboards (`?kind=`, `?status=` filters) |
| **GET** | **`/api/archive`** | **(NEW)** List all archived seasons (metadata only) |
| **GET** | **`/api/archive/<seasonId>?division=`** | **(NEW)** Fetch immutable snapshot for one season+division |

### Admin Endpoints

All under `/api/admin/`, require `role === 'admin'`.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/admin/members` | List / manage members |
| POST | `/api/admin/members/add` | Add member manually |
| POST | `/api/admin/members/approve` | Approve member |
| POST | `/api/admin/members/reject` | Reject member |
| POST | `/api/admin/members/update` | Update member |
| GET/POST | `/api/admin/weekly-races` | List / create races (now auto-binds to active main season leaderboards, accepts optional `seasonId` field) |
| POST | `/api/admin/weekly-races/update` | Update race |
| POST | `/api/admin/weekly-races/results` | Enter race results |
| POST | `/api/admin/weekly-races/participants` | Manage participants |
| **GET/POST** | **`/api/admin/weekly-races/bind-leaderboards`** | **(NEW)** Get/set race↔leaderboard bindings |
| GET/POST | `/api/admin/hero-banner` | List / manage banners |
| POST | `/api/admin/hero-banner/update` | Update banner |
| GET/POST | `/api/admin/events` | List / create events |
| POST | `/api/admin/events/update` | Update event |
| GET/POST | `/api/admin/news` | List / create news |
| POST | `/api/admin/news/update` | Update news |
| GET/POST | `/api/admin/guides` | List guides |
| POST | `/api/admin/guides/add` | Add guide |
| POST | `/api/admin/guides/update` | Update guide |
| POST | `/api/admin/guides/approve` | Approve guide |
| POST | `/api/admin/guides/reject` | Reject guide |
| GET/POST | `/api/admin/fan-media` | List fan media |
| POST | `/api/admin/fan-media/add` | Add fan media |
| POST | `/api/admin/fan-media/update` | Update fan media |
| POST | `/api/admin/fan-media/approve` | Approve fan media |
| POST | `/api/admin/fan-media/reject` | Reject fan media |
| GET/POST | `/api/admin/writings` | List writings |
| POST | `/api/admin/writings/approve` | Approve writing |
| POST | `/api/admin/writings/reject` | Reject writing |
| GET/POST | `/api/admin/migrate` | Run DB migrations (now includes migration 014) |
| **GET/POST/PATCH** | **`/api/admin/seasons`** | **(NEW)** List / create / update seasons (validates status transitions) |
| **POST** | **`/api/admin/seasons/archive`** | **(NEW)** Take immutable snapshot of an ended season (one-way operation) |
| **GET** | **`/api/admin/seasons/standings?id=&division=`** | **(NEW)** Preview standings before archiving (or fetch snapshot if already archived) |

---

## 6. Frontend Pages

### Homepage (`index.html` — 1236 lines)
- **Hero banner**: Dynamically loaded from `/api/hero-banner` (supports YouTube embed, image, video)
- **News section**: Latest 3 news from API
- **About section**: Static HTML showing the "global community" evolution content with green "Learn More" button linking to about.html
- **Events section**: Upcoming events from API (not filtered by season — Events = admin-categorized posts)
- **Community section**: Activity feed, YouTube feed, member count
- **Page switching**: SPA-like section navigation via `data-nav-link` and `data-overlay-link` attributes
- **Carousel**: Horizontal scrolling news/events cards
- **Particle canvas background**: `particles.js`

### Weekly Race (`weekly-race.html` — 1330 lines)
- Two modes:
  1. **Single race** (URL: `?slug=race-name`): Shows race details, track info, deadline, join/leave, Pick'em
  2. **Race listing** (no slug): Shows all published races as cards
- **Join section**: Self-join/leave for logged-in approved members with Trainer ID
- **Pick'em section**: Submit top-3 predictions, view existing predictions
- **Results section**: After admin enters results, shows positions
- **Cross-links**: Links to racer leaderboard and Pick'em leaderboard
- **Inline script** (~700 lines): `renderRaceCard()`, `loadJoinSection()`, `loadPickemData()`, all DOM manipulation

### About (`about.html` — 399 lines)
- Standalone page with MURA community info
- YouTube video embed hero section
- Community values, leadership history (anonymized departed members)
- Social links (Discord, YouTube, Twitter)

### Admin Panel (`admin/index.html` — 3,276 lines)
- Full SPA with tab-based navigation
- Tabs: Overview, Members, Writings, Fan Media, Guides, Races, Events, News, **Seasons**, **Boards** (Leaderboards), **Archive**, Banner, Migrations
- All CRUD operations via admin API endpoints
- Race management: Create, update, add participants, enter results, **bind to leaderboards** (Phase 3)
- Member management: Approve, reject, update roles
- Content management: News, events, guides, fan media, writings
- **Season management** (Phase 3): Create main seasons / event leaderboards, edit, start/end/archive with strong confirmation (typed season ID required for archive)
- **Leaderboards preview** (Phase 3): Read-only view of active/upcoming seasons with division standings preview modal
- **Archive view** (Phase 3): Read-only view of archived seasons with snapshot detail modal showing "IMMUTABLE" badge + snapshot timestamp

### Other Pages
- **Login/Register**: Standard auth forms with hCaptcha
- **Edit Profile**: Name, bio, Trainer ID, favorite Uma, avatar upload
- **Guides/Guide**: Listing + detail with voting
- **Race Leaderboard** (`race-leaderboard.html` — 846 lines): Seasonal + All-Time standings with dynamic `<select>` dropdown populated from `/api/seasons` (Phase 4). Division tabs (graded/open), top-3 podium, full rankings table, inline racer detail expansion
- **Pick'em Leaderboard** (`pickem-leaderboard.html` — 322 lines): Main-seasons-only standings with dynamic `<select>` dropdown (Phase 4). Pick'em does not run for event leaderboards
- **Leaderboard Archive** (`archive.html` — 565 lines, NEW Phase 4): Public page listing all archived seasons with division buttons linking to detail view. Detail view shows the immutable snapshot standings table with prominent "IMMUTABLE" badge + snapshot timestamp
- **Fan Media**: Four category pages (fanart, videos, writings, music)
- **Submit pages**: Writing, fan media, guide creation forms

---

## 7. Navigation System

### Current State (Hybrid — partially broken)

The navigation system is currently in a **transitional and problematic state**. There are three different systems in play:

#### System A: `layout.js` Runtime Includes (LEGACY, PROBLEMATIC)
- `layout.js` fetches nav/footer HTML from `/includes/` at runtime
- Dispatches `mura:layout-ready` custom event when done
- **Problems**: Race conditions with auth.js and nav-overlay.js, 5-second timeout can leave pages broken
- **Status**: Still loaded on pages using `<div id="site-nav"></div>` + `<div id="site-footer"></div>`

#### System B: `build.js` Marker-Based Replacement (APPROVED, NOT FULLY DEPLOYED)
- HTML pages have `<!-- MURA:NAV:START -->` / `<!-- MURA:NAV:END -->` markers
- `build.js` reads templates from `/includes/`, resolves `{{NAVLINK_PREFIX}}` and other vars, writes between markers
- **Advantages**: Zero runtime fetch, zero race conditions
- **Status**: Markers are in most pages but the generated content may be outdated

#### System C: Inline HTML (CURRENT STATE ON SOME PAGES)
- Some pages have full nav/footer/overlay HTML inlined directly (from before debloat, or from manual fixes)
- The `5c3490a` commit did a "comprehensive debloat regression fix" that restored inline HTML on weekly-race.html

### Three Nav Variants

1. **Homepage** (`nav-home.html`): Uses `#anchor` links for same-page scrolling, plus `about.html` and `weekly-race.html` as separate page links. Includes `Races` link and desktop auth buttons.
2. **Root sub-pages** (`nav.html` with `navlinkPrefix='index.html'`): Uses `index.html#anchor` links. Does NOT include a `Races` link in the template — this is a known bug.
3. **Fan-media sub-pages** (`nav-sub.html`): Uses `../index.html#anchor` relative paths. Includes `Races` link and desktop auth buttons.

### Navigation Items
- **Homepage nav**: News (#news), About (about.html), Events (#events), Community (#community), Races (weekly-race.html), Auth buttons
- **Sub-page nav (build.js template)**: News, About, Events, Community — **missing Races link** (this is the bug the user reported)
- **Fan-media nav**: News (news-detail.html), About (about.html), Events (event-detail.html), Community (../index.html#community), Races (weekly-race.html)

### Key Issue
The `nav.html` template used by `build.js` for root sub-pages does NOT include:
- A "Races" link
- An "About" link to about.html (it links to `#about` instead)
- Desktop auth buttons

The `nav-home.html` (used by `layout.js` for the homepage) HAS these links correctly.

---

## 8. Authentication System

### Flow
1. **Registration**: POST `/api/register` with hCaptcha token → creates member with `status='pending'` (or `status='approved'` if Trainer ID provided — auto-approve)
2. **Login**: POST `/api/login` with username + password → returns JWT in httpOnly cookie `mura_session`
3. **Session check**: GET `/api/me` → returns `{ userId, username, displayName, role, status, avatarUrl }`
4. **Logout**: POST `/api/logout` → clears cookie

### Auth Object Shape
```javascript
// From /api/me response:
{
  result: 'success',
  user: {
    userId: 5,          // ALWAYS use user.userId, NEVER user.id
    username: 'racer1',
    displayName: 'Racer One',
    trainerId: '123456789012',
    favoriteUma: 'Special Week',
    bio: '...',
    role: 'member',     // 'member' or 'admin'
    status: 'approved', // 'pending', 'approved', 'rejected'
    avatarUrl: '/api/avatar/123456789012',
    joinedAt: '2026-06-11T...'
  }
}
```

### Client-Side Auth (`js/auth.js`)
- Runs `checkAuth()` on DOMContentLoaded
- Fetches `/api/me`, updates `window.muraCurrentUser`
- Toggles visibility of `[data-auth]` elements:
  - `data-auth="logged-out"` — shown when not logged in
  - `data-auth="logged-in"` — shown when logged in
  - `data-auth="admin"` — shown only for admins
  - `data-auth="pending"` / `data-auth="approved"` — status-based
  - `data-auth="logout"` — logout buttons with click handlers
- Re-runs on `mura:layout-ready` event (for pages using `layout.js`)

### Auto-Approve (Silent Rule)
- Members who register with a valid 12-digit Trainer ID are silently auto-approved
- This rule must remain **secret** — if people know, trolls will enter fake IDs
- Profile update also auto-approves if a pending member adds their Trainer ID

---

## 9. Build System

### Tailwind CSS Build
```bash
npm run build:css   # → NODE_ENV=production npx tailwindcss -i ./css/tailwind-src.css -o ./css/tailwind.min.css --minify
npm run watch:css   # → development watch mode
```

### `build.js` — Nav/Footer Include Builder
**Location**: `/home/z/my-project/murauma-repo/build.js`

**Usage**:
```bash
node build.js              # Rebuild all pages (replace content between markers)
node build.js --init       # Initial conversion (add markers to unconverted pages)
node build.js guides.html  # Rebuild specific page(s)
```

**How it works**:
1. Reads page configs from `PAGE_CONFIGS` (19 pages defined)
2. For each page, loads templates from `/includes/` (nav.html, overlay.html, footer.html)
3. Resolves template variables: `{{NAVLINK_PREFIX}}`, `{{LOGO_HREF}}`, `{{REL_PREFIX}}`, `{{LOGO_ID_ATTR}}`, `{{DATA_NAV_LINK}}`, `{{DATA_OVERLAY_LINK}}`, `{{DESKTOP_AUTH}}`
4. Finds markers in HTML files: `<!-- MURA:NAV:START -->` / `<!-- MURA:NAV:END -->`, etc.
5. Replaces content between markers with resolved template HTML
6. Also replaces inline burger JS with `<script src="/js/nav-overlay.js">` and adds DOMPurify fallback

**Page Configs**:
- Homepage: `navlinkPrefix: ''`, `isHome: true`
- Root sub-pages: `navlinkPrefix: 'index.html'`, `isHome: false`
- Fan-media: `navlinkPrefix: '../index.html'`, `isHome: false`

**Resolved Issues with build.js** (fixed as of 2026-06-15):
1. ~~The `nav.html` template is missing the "Races" link~~ — **Fixed**: All nav variants now include Races link
2. ~~The `nav.html` template links About to `#about` instead of `about.html`~~ — **Fixed**: About now links to about.html
3. ~~The `overlay.html` template is missing the "Races" link~~ — **Fixed**: Overlay includes Races link
4. The `overlay.html` template has heavy SVG icons in auth buttons (should be text-only like nav-home.html) — **Minor, still present**
5. Desktop auth buttons are only injected for `isHome: true` pages, but root sub-pages also need them — **May still need attention**

### Approved But Not Implemented: Full Build-Time Debloat Plan

**Current state (Sept 2026): 95% complete.** The 10-step plan below is mostly done. Items marked ✅ are verified complete; items marked ⏳ are the remaining 5%.

1. ✅ Update `nav.html` template to include Races link and correct About link
2. ✅ Update `overlay.html` template to match nav-home.html style (text-only auth, Races link) — partially; heavy SVGs in auth buttons are still there but functional
3. ✅ Add desktop auth buttons to non-homepage configs (verified across 21 pages)
4. ⏳ Run `build.js` on all 21 pages to regenerate nav/footer/overlay — **MEDIUM RISK**: would overwrite any inlined nav edits (e.g., the new "Archive" link was added directly to `archive.html`, not to the nav partial). Run `build.js` with `--dry-run` first to review the diff.
5. ✅ Remove `layout.js` dependency from all pages — verified: zero HTML files reference `/js/layout.js` via `<script src>`
6. ✅ Remove `<div id="site-nav">` / `<div id="site-footer">` placeholders — verified: zero HTML files contain these IDs
7. ⏳ Remove `mura:layout-ready` event listener from `auth.js` (line ~145) — dead code, never fires. Safe to delete.
8. ⏳ Delete `js/layout.js` file entirely — orphaned (63 lines, no references). Safe to delete.
9. ✅ Test all pages — all 21 pages render correctly in production
10. ⏳ Commit and deploy — pending items 4, 7, 8

**Recommendation (Sept 2026):** Don't do this cleanup right now. The remaining items are purely cosmetic dead-code removal (~70 lines total) and don't affect functionality. Doing them as a separate isolated commit later is safer than bundling with feature work. See §15 for the priority ranking.

---

## 10. Current Known Issues

### Previously Reported — Now Fixed (as of 2026-06-15)

1. ~~**Race menu missing from nav on sub-pages**~~ — **FIXED**: All pages now show "Races" link in both desktop nav and mobile overlay. Verified on homepage, weekly-race.html, guides.html, about.html.

2. ~~**Hero banner showing wrong media**~~ — **FIXED**: Current hero banner shows correct title, link, and video. The `mediaType` rendering (YouTube/image/video) is working correctly.

3. ~~**About section on homepage reverted to old content**~~ — **FIXED**: Homepage About section shows updated content mentioning "global community" evolution.

4. ~~**About page link missing from homepage**~~ — **FIXED**: Green "Learn More" button in About section links to `about.html`.

5. ~~**About nav menu scrolls to homepage section**~~ — **FIXED**: All pages (including homepage) now link About to `about.html` instead of `#about`.

### Recently Fixed (September 2026)

6. ~~**pickem-leaderboard.html stuck on "Loading leaderboard..."**~~ — **FIXED** (`bb7403b`, June 2026): The debloat commit had accidentally deleted the inline `<script>` that calls `/api/race-predictions/leaderboard`. Restored with avatar support + graceful error handling.

7. ~~**Cloudflare Pages build failure**~~ — **FIXED** (`55ce2f1`, Sept 2026): `functions/api/race-leaderboard/index.js` had wrong import path (`../_shared/utils.js` instead of `../../_shared/utils.js`). Single-line fix.

8. ~~**Admin "Preview" buttons invisible**~~ — **FIXED** (`a93a598`, Sept 2026): Tailwind CSS needed rebuild to include new color classes (`bg-sky-500`, `bg-slate-500`, `bg-indigo-500`, `bg-amber-100`, etc.) used by the Phase 3 admin UI.

### Pre-Existing Issues (not regressions, low priority)

9. **Avatar API images broken**: Some avatar URLs return broken images. Pre-existing — likely an issue with how the avatar endpoint serves some images.

10. **imgbb hotlink protection**: Some images hosted on imgbb (used in about.html) may be blocked by hotlink protection. Consider re-hosting images in the repo or on Cloudflare R2.

### Architecture Issues (intentional, not bugs)

11. **Dead code in `js/auth.js`**: Has a `document.addEventListener('mura:layout-ready', ...)` listener at ~line 145 that never fires (since `layout.js` is no longer loaded by any page). Safe to delete — see §9 debloat item 7.

12. **Orphaned `js/layout.js` file**: 63 lines, no HTML page references it. Was the runtime nav/footer loader before the build-time debloat. Safe to delete — see §9 debloat item 8.

13. **Three nav variants**: `nav-home.html` (homepage), `nav.html` (sub-pages via build.js), `nav-sub.html` (fan-media). All now include the correct links (Races, about.html). Some inconsistency in SVG icon weight between variants — purely cosmetic.

---

## 11. Git History & Key Commits

### Recent Commits (chronological, newest first)

| Hash | Date | Description |
|------|------|-------------|
| `5ff9cc7` | 2026-09-17 | feat: Phase 4 — public UI (dynamic season dropdowns + new archive.html) |
| `a93a598` | 2026-09-17 | fix: rebuild Tailwind CSS to include new color classes used in Phase 3 |
| `55ce2f1` | 2026-09-17 | fix: correct _shared/utils.js import path in race-leaderboard/index.js (broke CF build) |
| `37e8712` | 2026-09-17 | feat: Phase 3 — admin UI for Seasons, Leaderboards, Archive, Race bindings |
| `d9bc2a1` | 2026-09-17 | feat: Phase 2.6 — refactor Pick'em leaderboard + add binding check |
| `d60c74d` | 2026-09-17 | feat: Phase 2.5 — refactor /api/race-leaderboard to be DB-driven (removed hardcoded SEASONS) |
| `95ff031` | 2026-09-17 | feat: Phase 2.4 — race-leaderboard bindings endpoint + auto-bind on race creation |
| `7c57bc7` | 2026-09-17 | feat: Phase 2.3 — admin archive + standings preview endpoints |
| `b2cc31b` | 2026-09-17 | feat: Phase 2.2 — admin seasons CRUD endpoint |
| `f83dd2f` | 2026-09-17 | feat: Phase 2.1 — public seasons & archive read endpoints |
| `e744f8a` | 2026-09-17 | feat: Phase 1 — leaderboards & seasons migration 014 |
| `bb7403b` | 2026-06-15 | fix: restore missing leaderboard script on pickem-leaderboard.html |
| `8a7bf0a` | 2026-06-15 | fix: align event-detail page title to plural 'Events - MURA' |
| `89615ba` | 2026-06-15 | feat: news-detail & event-detail show listing when no slug provided |
| `5c3490a` | 2026-06-15 | fix: comprehensive debloat regression fixes across all pages |
| `a31c540` | 2026-06-15 | fix: restore accidentally deleted inline script in weekly-race.html |
| `0a903e8` | 2026-06-15 | feat: debloat nav/footer/overlay — extract to includes + build.js + nav-overlay.js |
| `9fbed0c` | 2026-06-15 | fix: comprehensive post-debloat stability fixes |
| `8abf6f8` | 2026-06-15 | fix: critical regression — content invisible, burger menu broken |
| `43f0b53` | 2026-06-15 | refactor: strip heavy SVG icons from overlay auth buttons |
| `4e0f876` | 2026-06-15 | refactor: eliminate ~100 lines of duplicated nav/footer/overlay/canvas from index.html |
| `774e832` | 2026-06-15 | Refactor: extract shared nav, footer, overlay JS into reusable includes |
| `7eb03b4` | 2026-06-15 | Hero banner: add per-banner poster/fallback image URL (posterUrl) |
| `3ed7228` | 2026-06-15 | Hero banner: add poster fallback image for video type |
| `5c69c60` | 2026-06-15 | Admin panel: add Database Migrations UI in overview |
| `b0942f8` | 2026-06-15 | Add migration API endpoint + schema 012 for video media type |
| `d35ad61` | 2026-06-15 | Hero banner: add 'video' media type for direct file URLs |
| `9466bf2` | 2026-06-15 | About page: replace hero image with looping YouTube video embed |
| `bf675df` | 2026-06-15 | About page: anonymize decline section, replace placeholder images |
| `283026b` | 2026-06-15 | About page: anonymize departed leadership, combine community sections |
| `d7a240d` | 2026-06-15 | Create dedicated About page and update site-wide navigation |
| `a6e28eb` | 2026-06-15 | Fix all navigation redirections for seamless flow |
| `7a1ab47` | 2026-06-15 | feat: News & Events listing pages + nav links to dedicated pages |
| `0f2bd11` | 2026-06-15 | feat: race listing page when no slug + API scope=all param |
| `60dd03f` | 2026-06-15 | ui: add Races to nav + cross-link bars between race pages |
| `18061d8` | 2026-06-12 | feat: add racer leaderboard with category-aware divisions |
| `862d53e` | 2026-06-12 | feat: add race categories (Open & Graded divisions) |
| `04bcbc7` | 2026-06-12 | feat: implement auto-approve and self-join for races |
| `0dbcb86` | 2026-06-12 | chore: rebuild Tailwind CSS — add Pick'em classes, remove unused |

### Key Git Reference Points

- **`774e832`** — Last known good state before debloat changes (pre-debloated working version)
- **`0a903e8`** — The debloat commit that accidentally deleted the weekly-race.html inline script and introduced nav template issues
- **`5c3490a`** — "Comprehensive debloat regression fixes" — last commit before September 2026 leaderboard work
- **`bb7403b`** — First commit of the September 2026 session — fixed the pickem-leaderboard stuck-on-loading regression
- **`e744f8a`** — Phase 1 of leaderboard system redesign — schema migration 014 (foundational)
- **`5ff9cc7`** — **CURRENT HEAD** — Phase 4 of leaderboard system redesign — public UI complete

---

## 12. Feature Plans

### Implemented Features

1. **Authentication System** (Schema 003)
   - JWT-based login, PBKDF2 password hashing
   - Role-based access (member/admin)
   - httpOnly session cookie

2. **Dynamic Content** (Schema 006-007)
   - Weekly races, events, news — admin-managed
   - Slug-based URLs for SEO

3. **Hero Banner** (Schema 008-013)
   - Supports YouTube, image, and direct video media types
   - Poster URL fallback for video
   - Admin management

4. **Guides System** (Schema 005)
   - Member-written game guides with rich HTML
   - Reddit-style upvote/downvote
   - Admin approval workflow

5. **Fan Media** (Schema 004)
   - Image, video, writing, music categories
   - Submission and approval workflow

6. **Pick'em System** (Schema 010)
   - Race predictions (top 3 finishers)
   - Scoring based on actual results
   - Leaderboard for predictors
   - **Restricted to main weekly/biweekly seasons** (Phase 2.6, Sept 2026)

7. **Race Categories** (Schema 011)
   - Open (A+ rank and below) and Graded (no rank limit) divisions
   - Separate leaderboards per category

8. **Self-Join & Auto-Approve** (Implemented 2026-06-12)
   - Members join races themselves from the race page
   - Trainer ID = silent auto-approve on registration

9. **Racer Leaderboard** (Implemented 2026-06-12, refactored Sept 2026)
   - Seasonal and all-time views
   - Graded/Open tabs
   - Top-3 podium cards
   - Inline racer detail expansion
   - Scoring: 1st=10, 2nd=6, 3rd=4, 4th=2, 5th+=1
   - **Now DB-driven** (Phase 2.5, Sept 2026) — hardcoded SEASONS constant removed

10. **Leaderboard System Redesign** (Schema 014, September 2026)
    - **Seasons** — admin-managed lifecycle (upcoming → active → ended → archived)
    - **Leaderboards** — auto-created per season (open, graded, pickem-if-active)
    - **Event leaderboards** — custom-named (e.g., "Merdeka Cup 2027") with open + graded divisions (no pickem)
    - **Race-leaderboard bindings** — many-to-many (a race can feed multiple leaderboards)
    - **Immutable archives** — DB-level triggers (`trg_archive_no_update`, `trg_archive_no_delete`) reject UPDATE/DELETE on snapshot rows
    - **Public archive page** at `/archive.html` — list view + detail view per division
    - **Admin UI** — Seasons / Boards / Archive sections + race binding field in race editor
    - See `/home/z/my-project/download/MURA-Leaderboard-Redesign-Plan.md` for the original design plan

### Planned Features (Not Yet Implemented)

11. **MURA Coins** (deferred indefinitely — September 2026 decision)
    - Virtual currency for race entry fees, betting, rewards
    - Pari-mutuel system for race payouts and bet payouts
    - 10% house cut (deflationary)
    - Starter grant: 200 coins per approved member
    - Entry fees: Open 50, Graded 100, Classic 300
    - Anti-abuse: Trainer ID uniqueness, no self-betting, bet limits
    - **Status**: On hold. User base is <20 people who mostly visit for race info, news, and standings. Adding a coin economy would add complexity without visible value. Revisit only if community engagement grows significantly.
    - See `docs/mura-coins-plan.md` for original design (now archived, not actively maintained)

### Phase 5 Leaderboard Enhancements (deferred — judged low value)

These were considered in the original leaderboard redesign plan but judged not worth implementing at current scale:

- Standalone `leaderboard.html` page for sharing event standings via URL (the season dropdown on race-leaderboard.html covers this use case)
- "Hall of Fame" view showcasing past season winners on homepage (users can already see past winners via archive.html)
- Auto-archive cron job (only 1-2 seasons/year — manual archive via admin UI takes 30 seconds)
- Snapshot export to git as static JSON (DB triggers already provide immutability — git export would be over-engineering)
- MURA Coins integration with leaderboard winners (depends on MURA Coins, also deferred)

---

## 13. Development Patterns & Conventions

### API Patterns
- All API files use `export async function onRequestGet(context)` or `onRequestPost(context)`
- `context` provides `{ request, env }` where `env.DB` is the D1 binding
- Auth check: `const { user, error } = await requireAuth(request, env); if (error) return error;`
- Optional auth: `const user = await getOptionalAuth(request, env);`
- **CRITICAL**: Always use `user.userId`, NEVER `user.id` (the auth system returns `userId`)
- Response helper: `errorResponse(message, status)` from `_shared/utils.js`
- CORS headers included on all endpoints

### Frontend Patterns
- All pages load: `tailwind.min.css`, `common.css`, `auth.js`
- Most pages load: `dompurify-fallback.js`, `nav-overlay.js`
- DOMPurify CDN + fallback pattern:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.5/purify.min.js"></script>
  <script src="/js/dompurify-fallback.js"></script>
  ```
- Auth state elements use `data-auth` attributes for show/hide
- Fade-in sections use `.fade-in-section` class with IntersectionObserver
- Page content is fetched from API and rendered client-side with vanilla JS

### CSS Patterns
- Skewed section headers: `.header-skew`, `.header-skew-green`, `.header-skew-pink`, etc.
- Pill navigation: `.nav-pill`, `.nav-pill-inner`, `.nav-pill-link`
- Full-page overlay: `.nav-overlay`, `.nav-overlay-menu`
- Content cards: `.content-card` with hover effects
- Carousel: `.no-scrollbar` for hiding scrollbars

### Database Migration Pattern
- Sequential numbered SQL files in `/schema/`
- Applied with: `npx wrangler d1 execute murauma-db --remote --file=./schema/NNN-name.sql`
- SQLite migration pattern: Create new table → Copy data → Drop old → Rename
- Admin panel has a "Database Migrations" tab that can run migrations via API

### Naming Conventions
- API files: kebab-case (e.g., `race-predictions.js`, `hero-banner.js`)
- DB columns: snake_case (e.g., `trainer_id`, `is_active`, `created_at`)
- JS variables: camelCase (e.g., `navlinkPrefix`, `muraCurrentUser`)
- CSS classes: BEM-ish with `nav-pill-` prefix for nav, `header-skew` for headers
- Template variables: `{{UPPER_SNAKE_CASE}}` in include templates

---

## 14. Deployment

### Hosting
- **Platform**: Cloudflare Pages
- **Domain**: `murauma.pages.dev`
- **Functions**: Auto-discovered from `/functions/` directory
- **Static assets**: Served from repo root

### Deployment Process
1. Push to `main` branch on the connected Git repository
2. Cloudflare Pages auto-builds and deploys
3. No build command needed (static HTML + JS)
4. Tailwind CSS must be built locally before push: `npm run build:css`

### Environment Variables (Cloudflare Dashboard)
- `HCAPTCHA_SECRET` — hCaptcha secret key for server-side verification
- `JWT_SECRET` — (set in utils.js or env) for JWT signing
- D1 binding `DB` is configured in `wrangler.toml`

### Caching (`_headers`)
- `tailwind.min.css`: 1 year, immutable
- `common.css`: 1 day
- Fonts: 1 year, immutable
- JS files: 1 day
- HTML pages: 1 hour
- API routes: no-store
- Sitemap/robots: 1 day

---

## 15. Outstanding TODO Items

### ✅ Completed — Bugs Fixed (as of 2026-09-17)
1. ~~**Add "Races" link to `nav.html` template**~~ — Done
2. ~~**Fix "About" link in `nav.html`**~~ — Done
3. ~~**Add "Races" link to `overlay.html` template**~~ — Done
4. ~~**Fix "About" link in `overlay.html`**~~ — Done
5. ~~**Fix hero banner media rendering**~~ — Done
6. ~~**Fix homepage About section**~~ — Done
7. ~~**Fix About section link to about.html**~~ — Done
8. ~~**pickem-leaderboard.html stuck on "Loading..."**~~ — Done (`bb7403b`)
9. ~~**Cloudflare Pages build failure**~~ — Done (`55ce2f1`)
10. ~~**Admin "Preview" buttons invisible**~~ — Done (`a93a598`)
11. ~~**Season management**~~ — Done (Phase 1-4 of leaderboard redesign, Sept 2026)
12. ~~**Pick'em leaderboard evaluation**~~ — Done. Decision: Pick'em is restricted to main weekly/biweekly seasons only (no event leaderboards).

### High Priority — Housekeeping (low risk, isolated commits)

13. **Commit `MURA-PROJECT-CONTEXT.md` to the repo** — currently untracked in repo root. Should probably go under `docs/` for organization.

14. **Build-time debloat completion** — 3 small steps remaining (see §9):
    - Delete `js/layout.js` (orphaned, 63 lines, safe)
    - Remove `mura:layout-ready` listener from `js/auth.js` (line ~145, dead code, safe)
    - Run `build.js` once to sync include partials with inlined HTML (medium risk — dry-run first)
    - **Recommendation**: Do as a separate isolated commit, not bundled with feature work.

15. **Real-world testing of leaderboard system** — actually:
    - Create a test event leaderboard (e.g., "Test Cup 2026") in admin
    - End Season 1 2026
    - Archive Season 1 2026 (irreversible — make sure you mean it)
    - Verify archive.html shows the snapshot
    - Verify All-Time standings still include all the data

### Medium Priority — Polish

16. **Simplify `overlay.html` auth buttons** — remove heavy SVGs, use text-only like `nav-home.html` (purely cosmetic)

17. **Fix avatar API** — some avatars return broken images. Likely an issue with how the avatar endpoint serves certain image types.

18. **Fix imgbb hotlink protection** — consider re-hosting images on Cloudflare R2 or in the repo itself.

### Deferred Indefinitely (see §12)

19. ~~**MURA Coins Phase 1**~~ — On hold (Sept 2026 decision). Revisit only if community engagement grows significantly.

20. ~~**Phase 5 leaderboard enhancements**~~ — Judged low-value at current scale. See §12 for the list.

### Won't Fix (intentionally)

21. **Racer leaderboard trend indicator** (climbing/falling/steady) — would require storing historical rankings. Not worth the complexity for <20 users.

22. **Season champion recognition** (badge, announcement) — admin can post a News article for this. No need for system-level feature.

---

## Appendix A: Key File Sizes

> Sizes are approximate (as of September 2026, after Phase 4 of leaderboard redesign).

| File | Lines | Notes |
|------|-------|-------|
| `admin/index.html` | 3,276 | Admin SPA — added Seasons/Boards/Archive sections in Phase 3 |
| `functions/_shared/utils.js` | 1,031 | Shared backend utilities |
| `weekly-race.html` | 1,330 | Race detail + listing |
| `index.html` | 1,236 | Homepage |
| `archive.html` | 565 | NEW — Phase 4 — public archive page (list + detail views) |
| `race-leaderboard.html` | 846 | Leaderboard page — now has dynamic season dropdown |
| `about.html` | 399 | About page |
| `edit-profile.html` | 391 | Profile editor |
| `write-guide.html` | 381 | Guide creation |
| `register.html` | 377 | Registration |
| `fan-media/fanart.html` | 340 | Fan art gallery |
| `submit-fan-media.html` | 329 | Fan media submission |
| `guide.html` | 302 | Individual guide |
| `functions/api/race-leaderboard/index.js` | 431 | Phase 2.5 refactor — DB-driven standings aggregation |
| `functions/api/admin/seasons/index.js` | 456 | NEW — Phase 2.2 — seasons CRUD |
| `functions/api/admin/seasons/archive.js` | 295 | NEW — Phase 2.3 — immutable snapshot endpoint |
| `functions/api/admin/seasons/standings.js` | 260 | NEW — Phase 2.3 — standings preview |
| `functions/api/admin/weekly-races/bind-leaderboards.js` | 191 | NEW — Phase 2.4 — race-leaderboard bindings |
| `functions/api/seasons.js` | 134 | NEW — Phase 2.1 — public list seasons |
| `functions/api/archive.js` | 79 | NEW — Phase 2.1 — public list archived seasons |
| `functions/api/archive/[seasonId].js` | 110 | NEW — Phase 2.1 — public fetch snapshot |
| `schema/014-leaderboards-seasons.sql` | 210 | NEW — Phase 1 — 4 tables + 2 triggers + backfill |
| `pickem-leaderboard.html` | 322 | Now has season dropdown (Phase 4) |
| `submit-writing.html` | 290 | Writing submission |
| `fan-media/music.html` | 291 | Music gallery |
| `fan-media/writings.html` | 281 | Writings gallery |
| `setup-account.html` | 258 | Legacy account setup |
| `event-detail.html` | 262 | Event detail |
| `fan-media/videos.html` | 261 | Video gallery |
| `news-detail.html` | 253 | News detail |
| `guides.html` | 226 | Guide listing |
| `login.html` | 218 | Login page |
| `js/layout.js` | 63 | ORPHANED — safe to delete (see §9 debloat item 8) |
| `js/auth.js` | ~150 | Has dead `mura:layout-ready` listener at line ~145 (see §9 debloat item 7) |

## Appendix B: API Function Sizes

> Sizes are approximate. New endpoints added in Phase 2 are marked **(NEW)**.

| File | Lines | Notes |
|------|-------|-------|
| `_shared/utils.js` | 1,031 | Shared utilities |
| `register.js` | 262 | Registration |
| `admin/seasons/index.js` | 456 | **(NEW)** Seasons CRUD (GET/POST/PATCH) |
| `race-predictions/index.js` | 255 | Pick'em CRUD — now validates pickem binding |
| `race-leaderboard/index.js` | 431 | **(REFACTORED)** DB-driven standings |
| `admin/seasons/archive.js` | 295 | **(NEW)** Immutable snapshot endpoint |
| `admin/seasons/standings.js` | 260 | **(NEW)** Standings preview |
| `members/profile.js` | 215 | Public profile |
| `admin/weekly-races/index.js` | 250 | Race management — now auto-binds leaderboards |
| `admin/weekly-races/bind-leaderboards.js` | 191 | **(NEW)** Race-leaderboard bindings |
| `admin/events/index.js` | 177 | Event management |
| `admin/news/index.js` | 171 | News management |
| `admin/members/update.js` | 168 | Member updates |
| `admin/weekly-races/participants.js` | 166 | Participant management |
| `weekly-races.js` | 163 | Race listing/detail |
| `admin/hero-banner/index.js` | 161 | Banner management |
| `race-leaderboard/member.js` | 188 | Racer detail — accepts ?season= param |
| `seasons.js` | 134 | **(NEW)** Public list seasons |
| `archive/[seasonId].js` | 110 | **(NEW)** Public fetch snapshot |
| `fan-media/submit.js` | 154 | Fan media submit |
| `youtube-feed.js` | 149 | YouTube RSS |
| `admin/migrate/index.js` | 250 | DB migrations — now includes migration 014 |
| `guides/index.js` | 149 | Guide listing |
| `submit.js` | 147 | Writing submit |
| `guides/submit.js` | 143 | Guide submit |
| `setup-account.js` | 139 | Legacy setup |
| `admin/hero-banner/update.js` | 136 | Banner update |
| `admin/weekly-races/update.js` | 134 | Race update |
| `race-predictions/leaderboard.js` | 230 | **(REFACTORED)** DB-driven, rejects event seasons |
| `admin/events/update.js` | 129 | Event update |
| `login.js` | 126 | Login |
| `admin/weekly-races/results.js` | 123 | Race results |
| `admin/news/update.js` | 121 | News update |
| `admin/members.js` | 121 | Member listing |
| `admin/guides/update.js` | 121 | Guide update |
| `race-participants/join.js` | 120 | Self-join |
| `admin/fan-media/index.js` | 111 | Fan media management |
| `archive.js` | 79 | **(NEW)** Public list archived seasons |
| `admin/guides/add.js` | 108 | Guide add |
| `events.js` | 105 | Event listing |
| `admin/fan-media/update.js` | 113 | Fan media update |
| `admin/members/add.js` | 117 | Member add |
| `news.js` | 117 | News listing |
| `admin/writings.js` | 99 | Writings management |
| `admin/guides/index.js` | 97 | Guide management |
| `members.js` | 92 | Member listing |
| `guides/vote.js` | 91 | Guide voting |
| `admin/fan-media/add.js` | 91 | Fan media add |
| `writings.js` | 87 | Writings listing |
| `fan-media/index.js` | 86 | Fan media listing |
| `race-participants/leave.js` | 83 | Leave race |
| `avatar/[[key]].js` | 80 | Avatar serving |
| `me.js` | 78 | Current user |
| `hero-banner.js` | 67 | Hero banner |
| `admin/members/approve.js` | 64 | Approve member |
| `admin/members/reject.js` | 62 | Reject member |
| `race-predictions/mine.js` | 60 | My predictions |
| `logout.js` | 30 | Logout |

## Appendix C: Full Schema Migration List

| # | File | Description | Status |
|---|------|-------------|--------|
| 001 | `001-initial.sql` | Members, writings, rate_limits tables | ✅ Applied |
| 002 | `002-writings-status.sql` | Add status column to writings | ✅ Applied |
| 003 | `003-auth.sql` | Auth system (username, password, role, user_id on writings) | ✅ Applied |
| 004 | `004-fan-media.sql` | Fan media table | ✅ Applied |
| 005 | `005-guides.sql` | Guides + guide_votes tables | ✅ Applied |
| 006 | `006-dynamic-content.sql` | weekly_races, events, news tables | ✅ Applied |
| 007 | `007-weekly-races-slug-content.sql` | Add slug + content to weekly_races | ✅ Applied |
| 008 | `008-hero-banner.sql` | Hero banner table | ✅ Applied |
| 009 | `009-hero-banner-normalize-url.sql` | URL normalization | ✅ Applied |
| 010 | `010-race-pickem.sql` | Race participants + predictions | ✅ Applied |
| 011 | `011-race-category.sql` | Open & Graded divisions | ✅ Applied |
| 012 | `012-hero-banner-video-type.sql` | Video media type for hero banner | ✅ Applied |
| 013 | `013-hero-banner-poster-url.sql` | Poster URL for video type | ✅ Applied |
| 014 | `014-leaderboards-seasons.sql` | Seasons, leaderboards, bindings, archive snapshots + 2 immutability triggers | ✅ Applied (Sept 2026) |

### Migration 014 details

Created 4 new tables + 2 triggers + ALTER on weekly_races + backfills:

1. **`seasons`** — `id`, `label`, `kind` (main/event), `start_date`, `end_date`, `status` (upcoming/active/ended/archived), `is_pickem_active`, `archived_at`
2. **`leaderboards`** — `id`, `season_id`, `division` (open/graded/pickem), `display_name`, `is_active`. UNIQUE(season_id, division).
3. **`race_leaderboard_bindings`** — junction table (race_id, leaderboard_id). Many-to-many.
4. **`season_archive_snapshots`** — `id`, `season_id`, `division`, `snapshot_json`, `snapshot_taken_at`, `is_locked`. Immutable when `is_locked=1`.
5. **`weekly_races`** ALTER — added `season_id` TEXT column (nullable, NULL = auto-resolve to active main season)
6. **Triggers**:
   - `trg_archive_no_update` — BEFORE UPDATE on `season_archive_snapshots`, ABORTs if `OLD.is_locked=1 AND NEW.is_locked=1`
   - `trg_archive_no_delete` — BEFORE DELETE on `season_archive_snapshots`, ABORTs if `OLD.is_locked=1`

Backfills performed:
- Inserted season `2026s1` (Season 1 2026, main, active, pickem ON, start=2026-06-01)
- Inserted 3 leaderboards for `2026s1` (open, graded, pickem)
- Set `season_id='2026s1'` on all existing races created >= 2026-06-01
- Created `race_leaderboard_bindings` rows linking each existing race to the appropriate `2026s1` leaderboards based on participant divisions
- Past Merdeka/Freedom Cup races remained in main seasonal standings (no retroactive event leaderboard creation — admin decision Sept 2026)

## Appendix D: Social Links

- **Discord**: https://discord.gg/QXSWZSv9z8
- **YouTube**: https://www.youtube.com/@MURAuma
- **Twitter/X**: https://x.com/MURA_umamusu

## Appendix E: External Services

- **hCaptcha**: Used on registration form for bot protection
- **Cloudflare D1**: SQLite database (binding: `DB`)
- **Cloudflare Pages**: Hosting + serverless functions
- **imgbb**: Image hosting (some about.html images, has hotlink protection issues)
- **DOMPurify CDN**: `cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.5/purify.min.js`
