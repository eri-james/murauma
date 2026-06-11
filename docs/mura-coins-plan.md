# MURA Coins — Feature Plan

> Created: 2026-06-11
> Status: Planning (not yet implemented)
> Context: MURA (Malayan Umamusume Racing Association) community site

---

## Overview

MURA Coins are a virtual currency for the MURA community, used to:

1. **Pay entry fees** for races (Open, Graded, Classic)
2. **Place bets** on race outcomes (pari-mutuel system)
3. **Earn rewards** from race performance and winning bets

---

## Economy Design

### Core Loop

```
Starter grant (one-time, 200 coins)
       ↓
Pay entry fee → Race → Earn reward (based on placement)
       ↓
Bet on other races (pari-mutuel) → Win or lose
       ↓
Pay Classic slot fee → Race Classic → Earn bigger reward
```

### Faucets (coin sources)
- Starter grant: 200 coins per new approved member
- Race rewards: pari-mutuel payout from entry pool (top 3)
- Bet winnings: pari-mutuel payout from betting pool

### Sinks (coin drains)
- Race entry fees: Open 50, Graded 100, Classic 300
- Bet stakes: lost bets are absorbed
- House cuts: 10% of race pool + 10% of betting pool (burned/deflationary)

### Anti-abuse
- **Trainer ID uniqueness**: Each MURA account must have a unique in-game Trainer ID, verified at registration. Prevents multi-account farming.
- **No self-betting**: If you're entered in a race, you cannot bet on it.
- **Bet limits**: Minimum 10 coins, maximum 40% of current pool.

---

## Race Lifecycle

The game (Umamusume Pretty Derby) runs races **asynchronously**:

1. **Host creates room in-game** → sets race settings, gets room code
2. **Host creates race on website** (admin panel) → Status: `ENTRY_OPEN` + `BETTING_OPEN`
   - Room code stored in DB (hidden behind paywall)
   - Entry fee set based on category
   - Gate open time set (up to 24 hours from room creation)
3. **Members pay entry fee** → room code revealed → they join in-game via code or club announcement
4. **Non-racing members place bets** → Win or Place bets on racers
5. **Gate opens** (at scheduled time) → Status: `GATE_OPEN`
   - Entry closes, betting closes
   - Race runs asynchronously (players watch on their own time within 24h window)
6. **Host records results** in admin panel → Status: `COMPLETED`
   - System auto-calculates payouts from pools
   - Coins distributed to race winners + winning bettors
   - All transactions logged

### Key Detail: Room Code as Paywall
The in-game room code is only revealed after paying the entry fee. No pay = no code = no race entry. Bettors (non-participants) never see the room code.

### Key Detail: Host Participation
The game requires the room host to also participate in the race. The host (currently the community leader) is a regular racer but also manages the race on the website. Self-betting rules still apply — host cannot bet on races they're in.

---

## Reward Structure (Pari-Mutuel)

### Race Payouts

Prize pool = (number of entrants × entry fee) - 10% house cut

**Payout split (top 3):**

| Position | Share |
|----------|-------|
| 1st | 50% of prize pool |
| 2nd | 30% of prize pool |
| 3rd | 20% of prize pool |
| 4th+ | 0% (lost entry fee) |

**Example — Open race, 8 participants:**
- Pool = 8 × 50 = 400
- House cut (10%) = 40 → burned
- Prize pool = 360
- 1st = 180, 2nd = 108, 3rd = 72

**Example — Graded race, 8 participants:**
- Pool = 8 × 100 = 800
- House cut = 80
- Prize pool = 720
- 1st = 360, 2nd = 216, 3rd = 144

**Example — Classic, 12 participants:**
- Pool = 12 × 300 = 3,600
- House cut = 360
- Prize pool = 3,240
- 1st = 1,620, 2nd = 972, 3rd = 648

### Betting Payouts (Pari-Mutuel)

- All bets go into a pool
- 10% house cut → burned
- Remaining 90% split among winning bettors proportional to their stake
- **Win bet**: pays out if your pick finishes 1st
- **Place bet**: pays out if your pick finishes in top 3 (lower payout than Win)

**Bet validation:**
- Minimum bet: 10 coins
- Maximum bet: 40% of current pool
- No self-betting (can't bet on a race you're entered in)
- Betting closes when gate opens

---

## Currency Rules

- **Integers only** — no decimals, no fractions
- **Starter grant**: 200 coins when account is approved
- **Non-transferable** — coins cannot be sent between members
- **No real-money value** — purely for community engagement

---

## Data Model

### Extend `weekly_races` (migration 010)

| Column | Type | Notes |
|--------|------|-------|
| entry_fee | INTEGER | 50/100/300 based on category |
| race_status | TEXT | `entry_open`, `gate_open`, `completed` |
| gate_open_time | TEXT (ISO) | When entry/betting closes |
| room_code | TEXT | In-game room code (hidden until entry fee paid) |
| prize_pool | INTEGER | Auto-calculated from entries |
| betting_pool | INTEGER | Auto-calculated from bets |
| house_cut_race | INTEGER | 10% of race pool, burned |
| house_cut_bets | INTEGER | 10% of betting pool, burned |

### New table: `race_entries`

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| race_id | INTEGER FK | → weekly_races |
| user_id | INTEGER FK | → members |
| position | INTEGER | NULL until results entered |
| payout | INTEGER | NULL until results entered |
| entered_at | TEXT | |

### New table: `bets`

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| race_id | INTEGER FK | → weekly_races |
| user_id | INTEGER FK | → members |
| bet_type | TEXT | `win` or `place` |
| target_user_id | INTEGER FK | the racer being bet on |
| amount | INTEGER | |
| payout | INTEGER | NULL until results |
| status | TEXT | `pending`, `won`, `lost` |
| created_at | TEXT | |

### New table: `coin_balances`

| Column | Type | Notes |
|--------|------|-------|
| user_id | INTEGER FK PK | → members |
| balance | INTEGER | Current balance |
| updated_at | TEXT | |

### New table: `coin_transactions`

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | |
| user_id | INTEGER FK | → members |
| amount | INTEGER | + or - |
| type | TEXT | `starter_grant`, `race_entry`, `race_reward`, `bet_place`, `bet_win`, `admin_adjust` |
| reference_id | INTEGER | race_id, bet_id, etc. |
| description | TEXT | Human-readable note |
| created_at | TEXT | |

---

## Public-Facing Features

### Race Detail Page (`/weekly-race.html`) — Enhanced
- Entry section: "Pay X coins to enter" → button → reveals room code
- Roster: Who's entered (visible to all, helps bettors decide)
- Betting section: Pick a racer → Win or Place → enter amount → confirm
- Live pari-mutuel odds display
- Results section: After completion, positions + payouts

### Member Coin Dashboard (new section in profile or new page)
- Current balance
- Recent transactions
- Active bets
- Race history + earnings

---

## Admin Panel Additions

- Race creation: add entry fee, gate open time, room code
- Race management: transition status (entry_open → gate_open → completed)
- Results entry: select position for each participant
- Payout review: see calculated payouts before confirming distribution
- Manual coin adjustments (for corrections/errors)
- House cut stats (total burned, economy health)

---

## Build Phases

### Phase 1 — Foundation
1. Migration 010: Add coin tables + extend weekly_races
2. Coin system API: balance, transactions, starter grant on approval
3. Admin: manual coin adjustments + view balances

### Phase 2 — Race Entry
4. Race entry flow: pay coins → see room code
5. Admin: set entry fee, room code, status transitions
6. Race detail page: entry UI + roster display

### Phase 3 — Betting
7. Betting API: place bet, validation (no self-bet, min/max, status check)
8. Race detail page: betting UI (Win + Place)
9. Odds display: live pari-mutuel odds based on current pool

### Phase 4 — Results & Payouts
10. Admin: results entry (position per participant)
11. Auto-payout calculation + distribution
12. Bet resolution + payout distribution
13. Transaction history + coin dashboard for members

---

## Context Notes

- "Classics" are weekly races that fall on (or close to) real-life JRA/MRA Classic races. They use the same unified race system, just with higher entry fees and bigger payouts.
- MURA moved from weekly to biweekly races starting 2026.
- The host must participate in the race (game requirement).
- Races are asynchronous — up to 24 hours for players to watch after gate opens.
- Current workflow: host opens room in-game → records race → announces results on Discord + website → tallies leaderboard points.
