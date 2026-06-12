# Self-Join & Auto-Approve — Feature Plan

> Created: 2026-06-12
> Status: Implemented (2026-06-12)
> Context: MURA (Malayan Umamusume Racing Association) community site

---

## Overview

Two changes that transform members from passive visitors into active participants:

1. **Auto-approve**: Members who register with a valid Trainer ID are silently auto-approved. No admin action needed.
2. **Self-join**: Approved members can join a race themselves from the race page, adding them to the Pick'em participant list automatically.

The goal: remove the admin as a bottleneck for the happy path, while keeping full admin control when needed.

---

## Auto-Approve

### The Trick

Members who include a valid Trainer ID during registration are automatically set to `status = 'approved'`. This is **never communicated** on the registration form — the form still says "Your account will be reviewed" or similar neutral language.

### Why It Works

- **Real players** include their Trainer ID because they want to race → they get approved instantly → seamless experience
- **Spammers/trolls** won't bother entering a 12-digit number, or won't know the exact format → they stay pending → never need to be actively rejected, they just languish
- **The rule stays secret** — once people know Trainer ID = auto-approve, every troll will just mash 12 random digits

### Edge Case: Trainer ID Added Later

If a member registers without Trainer ID (stays pending), then later adds their Trainer ID via profile edit → the system should auto-approve them at that point. They shouldn't need to re-register or wait for manual review.

### Implementation

- On registration: if `trainer_id` is provided and validates (12 digits, not already taken) → set `status = 'approved'` instead of `'pending'`
- On profile update: if member is `pending` and a valid `trainer_id` is added → update `status = 'approved'`
- No changes to the registration form UI or messaging

### Trainer ID Trust

Can someone fake a Trainer ID? Yes — it's just 12 digits. But the risk is low:

- **For racing**: If someone joins a race with a fake ID, they can't enter the in-game room. The host sees who joins. Fakes get exposed immediately.
- **For Pick'em**: They can submit predictions, which is harmless (free, no currency). No damage.
- **For trolling the participant list**: Admin can remove them from the dashboard.
- **Trainer ID uniqueness**: The DB already enforces `trainer_id TEXT UNIQUE`. Nobody can impersonate a real member's already-registered ID.

If fake IDs ever become a problem, stronger verification can be added later (e.g., screenshot of in-game profile, or a verification code system). Not needed at current community size.

---

## Self-Join

### The Flow

```
Register (with Trainer ID) → Auto-approved → Go to race page → Click "Join" → Added to participants
```

No admin needed for the happy path. The admin still has full control — you can remove participants, add people manually (e.g., Discord-only members who didn't use the website), and enter results.

### Race Page Changes

On `weekly-race.html`, add a **"Join Race"** button that:

- Only appears for logged-in, approved members
- Only appears if the race is still open (no results entered yet)
- Only appears if the member has a Trainer ID in their profile
- Only appears if the member hasn't already joined
- Adds the member to `race_participants` with `position = NULL`
- After joining, button changes to "Joined ✓" with an option to "Leave" (un-join)

### Guard Rails

- **Can only join if race is open** — if results are already entered, the join button is hidden or says "Race closed"
- **Can only join once per race** — DB already enforces `UNIQUE(race_id, member_id)`
- **Can un-join before results** — saves admin from removing misclicks. Button changes to "Leave Race". Once results are entered, leaving is disabled.
- **Must have Trainer ID** — the join button is greyed out / hidden with a message "Add your Trainer ID to your profile to join races" if they don't have one
- **Admin still sees everyone** — the Pick'em modal in the dashboard shows all participants, whether they joined themselves or were added by admin

### What the Race Page Shows

Before joining:
```
[ Join This Race ]   ← button, only if eligible
```

After joining:
```
✓ You're in this race!   [ Leave Race ]
```

After results:
```
✓ You finished 3rd! (4 pts)
```

If not eligible (no Trainer ID):
```
🔒 Add your Trainer ID to your profile to join races
```

If not logged in:
```
🔒 Log in to join this race
```

### Admin: No Change to Existing Workflow

The admin Pick'em modal still works exactly as before:
- See all participants (whether self-joined or admin-added)
- Add participants manually (for members who only use Discord)
- Remove participants
- Enter results

Self-join just means the list populates itself for the common case.

---

## The Chain of Incentives

| Before | After |
|--------|-------|
| Admin adds every participant manually | Members join themselves |
| Admin approves every registration | Trainer ID = auto-approve (silent) |
| Members only visit site for results | Members visit to join, predict, check standings |
| Trainer ID is optional decoration | Trainer ID is the gateway to participation |
| Admin is the bottleneck | Admin only intervenes for exceptions |

Trainer ID transforms from a nice-to-have profile field into the **linchpin of the engagement system**. No explicit verification system needed — the in-game room naturally exposes fakes.

---

## Future: Entry Fees (MURA Coins)

When MURA Coins launches with entry fees, the self-join flow becomes:

```
Go to race page → Click "Join" → Pay entry fee (coins) → Added to participants → Room code revealed
```

The fee naturally filters out casual joins — people only join races they intend to actually race. The current free join is the v1 that builds the habit of visiting the website.

---

## Data Model Changes

### No new tables needed

The existing tables already support this:
- `members.status` — already exists ('pending' / 'approved')
- `members.trainer_id` — already exists (UNIQUE, validated to 12 digits)
- `race_participants` — already exists (race_id, member_id, position, added_at)

### API additions

- **`POST /api/race-participants/join`** — self-join a race (requires auth + approved status + Trainer ID)
- **`POST /api/race-participants/leave`** — un-join a race (requires auth, only before results)
- **Registration + profile update** — auto-approve logic (backend change only)

### Registration change

In the existing registration API:
```javascript
// After creating the member:
if (validatedTrainerId) {
  // Auto-approve members who provide a valid Trainer ID
  status = 'approved';
} else {
  status = 'pending';
}
```

### Profile update change

In the existing profile update API:
```javascript
// If member is pending and adding a Trainer ID:
if (member.status === 'pending' && validatedTrainerId) {
  await db.prepare('UPDATE members SET status = ? WHERE id = ?').bind('approved', memberId).run();
}
```

---

## Build Phases

### Phase 1 — Auto-Approve
1. Registration API: auto-approve if Trainer ID provided
2. Profile update API: auto-approve if Trainer ID added while pending
3. No UI changes — purely backend, silent

### Phase 2 — Self-Join
4. Self-join API endpoint (`POST /api/race-participants/join`)
5. Self-leave API endpoint (`POST /api/race-participants/leave`)
6. Race page UI: "Join Race" button with all guard rails
7. Admin: no changes needed (already works)

---

## Context Notes

- This feature turns the website from an information board into an engagement platform
- The in-game room acts as natural verification — fakes are exposed when they can't join the room
- Entry fees (MURA Coins) will naturally filter casual joins later
- Trainer ID uniqueness is already enforced at the DB level
- The auto-approve rule must remain secret to maintain its effectiveness
