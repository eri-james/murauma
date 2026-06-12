# Racer Leaderboard — Feature Plan

> Created: 2026-06-12
> Status: Phase 1 + Phase 2 implemented (commit 18061d8)
> Context: MURA (Malayan Umamusume Racing Association) community site
> Dependency: Pick'em results system (migration 010 — already applied)

---

## Overview

A public leaderboard ranking racers by performance across races. Replaces the manual Google Sheets leaderboard with an automated, self-populating page that updates whenever the admin enters race results.

**Core principle**: Zero extra admin work. The leaderboard is a read-layer over data already being captured through the Pick'em results flow.

---

## Scoring Model

| Position | Points |
|----------|--------|
| 1st | 10 |
| 2nd | 6 |
| 3rd | 4 |
| 4th | 2 |
| 5th+ | 1 |

**Why this curve:**
- 1st place is worth more than 2nd + 3rd combined — winning is special
- Podium (1st–3rd) has clear separation from the rest
- Showing up still counts — 1 point for entering, so even a bad race isn't zero
- The gap structure naturally creates tiers: champions, contenders, regulars

**Tiebreaker chain:** most 1sts → most 2nds → most 3rds → fewest races (efficiency — same points in fewer races = higher average)

---

## Seasons

### Definition
- **A season = ~6 biweekly races** (approximately one quarter / 12 weeks)
- Seasons are tracked by **date range**, not hardcoded race count
- More flexible: handles skipped weeks, bonus races, or future weekly schedule changes

### Season 1 2026
- Starts: Race day tomorrow (the first race with Pick'em results)
- Ends: After the 6th biweekly race (~late August / early September)
- All subsequent seasons follow the same pattern

### Season vs All-Time
- **Season view** (default): creates urgency, comeback narratives, "Season Champion" recognition
- **All-time view**: legacy stats, career achievements
- Both are just date-range filters on the same data — no data reset, no migration between seasons

### Why not monthly?
With biweekly races, a monthly season = only 2 races. Not enough data points for meaningful rankings. 6 races (~quarterly) gives enough room for comebacks, consistency to matter, and a champion who actually earned it.

### Future-proofing
If MURA ever switches to weekly races, the same quarterly window just gets denser (12 races/season instead of 6). No system changes needed.

---

## Page Structure

### URL
`/race-leaderboard.html` — dedicated public page

### Default View: Current Season
- **Top 3 highlight**: Gold/silver/bronze cards with larger avatars and prominent stats
- **Full rankings table**: Every racer with points, sorted by score
  - Columns: Rank, Name, Points, Wins, Podiums, Races, Avg Position
- **Season toggle**: Switch between current season / all-time
- **Expandable racer detail**: Click a racer name → inline expand showing:
  - Last 5 races: date, race title, position finished
  - Simple trend indicator (climbing/falling/steady)

### All-Time View
- Same layout, unfiltered date range
- For veterans who want to see their career legacy

---

## Racer Detail (Inline, Not Separate Page)

When a racer name is clicked, an expandable section shows:
- **Recent results**: Last 5 races with position
- **Season trend**: Direction of performance (improving / declining / steady)

**Why not a full profile page?** As a solo manager, one great leaderboard beats ten mediocre profile pages. Profile pages can come when MURA Coins needs them. Keep it light for v1.

---

## Pick'em Leaderboard — Future Decision

The Pick'em leaderboard (predictor rankings) and the Racer leaderboard serve different audiences:
- **Racer leaderboard**: for participants (competitors)
- **Pick'em leaderboard**: for spectators (predictors)

**Decision**: Give Pick'em leaderboard Season 1 as a trial. Evaluate adoption after the season. If usage is low (few predictions, few people checking it), fold it into the racer leaderboard page as a secondary tab, or remove the standalone page and keep predictions as just a side feature on the race detail page. Prediction scores remain in the database (useful for MURA Coins later), but a dedicated public leaderboard requires volume to be worthwhile.

**Threshold**: If fewer than ~5 members actively predict across the season, the standalone Pick'em leaderboard page is not worth maintaining.

---

## Data Source

**No new tables, no new migrations, no new admin workflows.**

All data already exists:
- `race_participants` (race_id, member_id, **category**, position) — populated when admin enters results
- `weekly_races` (id, title, created_at) — already exists
- `members` (id, name, trainer_id) — already exists

The leaderboard API is pure aggregation with category filter:

```sql
SELECT
  rp.member_id,
  m.name AS member_name,
  m.trainer_id,
  COUNT(*) AS total_races,
  SUM(CASE WHEN rp.position = 1 THEN 10
           WHEN rp.position = 2 THEN 6
           WHEN rp.position = 3 THEN 4
           WHEN rp.position = 4 THEN 2
           ELSE 1 END) AS total_points,
  SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN rp.position = 2 THEN 1 ELSE 0 END) AS seconds,
  SUM(CASE WHEN rp.position = 3 THEN 1 ELSE 0 END) AS thirds,
  SUM(CASE WHEN rp.position <= 3 THEN 1 ELSE 0 END) AS podiums,
  ROUND(AVG(rp.position), 2) AS avg_position
FROM race_participants rp
JOIN members m ON m.id = rp.member_id
JOIN weekly_races wr ON wr.id = rp.race_id
WHERE rp.position IS NOT NULL
  AND rp.category = ?  -- 'graded' or 'open'
  AND wr.created_at >= ?  -- season start date (or '1970-01-01' for all-time)
GROUP BY rp.member_id
ORDER BY total_points DESC, wins DESC, seconds DESC, thirds DESC, total_races ASC
```

Plus a cross-division query that shows each racer's presence in the other category.

---

## API Design

### `GET /api/race-leaderboard`

**Query parameters:**
- `season=2026s1` — season identifier (optional, defaults to current season)
- `allTime=true` — skip season filter (optional)

**Response:**
```json
{
  "result": "success",
  "message": "Leaderboard loaded.",
  "season": { "id": "2026s1", "label": "Season 1 2026", "startDate": "2026-06-12", "raceCount": 3 },
  "leaderboard": [
    {
      "rank": 1,
      "memberId": 5,
      "memberName": "RacerName",
      "trainerId": "123456789012",
      "totalPoints": 22,
      "wins": 2,
      "seconds": 0,
      "thirds": 1,
      "podiums": 3,
      "totalRaces": 4,
      "avgPosition": 1.75
    }
  ]
}
```

### `GET /api/race-leaderboard/member?memberId=N`

**Racer detail** — recent race results for inline expansion.

**Response:**
```json
{
  "result": "success",
  "member": { "name": "RacerName", "trainerId": "..." },
  "recentRaces": [
    { "raceId": 3, "raceTitle": "Week 3 Sprint", "date": "2026-07-10", "position": 1, "points": 10 }
  ],
  "stats": { "totalPoints": 22, "wins": 2, "podiums": 3, "totalRaces": 4 }
}
```

---

## Season Configuration

Seasons are defined by date ranges. Stored as a simple config (could be a JSON env var, a D1 table, or hardcoded initially):

**v1 approach**: Hardcode in the API. Season 1 starts tomorrow. When it ends, add Season 2 config. Simple, no admin UI needed for a solo manager.

**Later approach**: Small D1 table `seasons` (id, label, start_date, end_date) + admin UI to create/close seasons. Not needed until there are multiple seasons to manage.

---

## Navigation

Add "Racer Leaderboard" link to:
- Site navigation bar (alongside existing Pick'em Leaderboard link)
- Race detail page (sidebar or header link)
- Home page community section

---

## Build Phases

### Phase 1 — Core Leaderboard (v1) ✅
1. ✅ Leaderboard API endpoint (`/api/race-leaderboard`) with category filter
2. ✅ Leaderboard page (`race-leaderboard.html`) with Graded/Open tabs
3. ✅ Season/all-time toggle
4. ✅ Add navigation links (home, race page, cross-linked with Pick'em)
5. ✅ Top 3 podium cards

### Phase 2 — Racer Detail ✅
6. ✅ Member detail API (`/api/race-leaderboard/member`)
7. ✅ Inline expandable racer detail on leaderboard page
8. ✅ Recent results + cross-division summary

### Phase 3 — Polish (later)
9. Season champion recognition (badge, announcement)
10. Trend indicator (climbing/falling/steady) in racer detail
11. Season management (D1 table + admin UI, when needed)

---

## What NOT to Build (Yet)

- **ELO or complex rating** — too opaque. Members need to understand scoring in one second. 10/6/4/2/1 is instant.
- **Team/group leaderboards** — not enough racers to fragment attention.
- **Achievements/badges** — scope creep. Points and rank ARE the achievement system.
- **Race class weighting** — a win is a win for now. Class weighting can come as a filter later when MURA Coins defines the tiers.
- **Separate racer profile pages** — inline detail is enough. Profiles come with MURA Coins.

---

## Context Notes

- First race with Pick'em results is tomorrow (Season 1, Race 1)
- Biweekly race schedule means ~6 races per quarter/season
- Season boundaries are date-range based for flexibility
- All data is already being captured via the existing Pick'em results flow
- The host (community leader) is also a regular racer in each race
- This feature is independent of MURA Coins but complementary — when Coins launches, the leaderboard gains entry fees, stakes, and payout history
