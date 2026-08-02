# MARK — Module Scores & Error Methodology

Last updated: 2026-07-28 (v7.8.2)

---

## Score Formula

```
Overall Score = (viewed - errors) / viewed * 100
```

Where:
- `viewed` = unique event keys from reviewer's deduplicated telemetry
- `errors` = unique event keys from computedErrors + computedFFErrors (5-rule engine)

---

## The 5-Rule Error Engine

All error computation happens in `bridge_script.js` BEFORE sending to MARK.
MARK's UI receives pre-computed `computedErrors[]` and `computedFFErrors[]`.

### Input data
- `dedupedEvents` — Apollo cache events filtered to current match+part, deduplicated
- `reviewerSetE` — Set of reviewer author IDs (top viewer only)
- `reviewerAddedKeys` — Keys of base events authored by reviewer (for Rule 1)

### Rule 1: Self-edits excluded
Reviewer amending their own added events = NOT an error.
The reviewer added a missed event → they're fixing it themselves → not a collector mistake.

### Rule 2: Same value excluded
`JSON.stringify(oldPayload) === JSON.stringify(newPayload)` → skip.
Reviewer made an amendment but didn't actually change the value.

### Rule 3: Deleted+Added / Deleted+Edited
Tolerance: ±1000ms (PAIR_TOLERANCE_MS).
- Find reviewer deletions → search for reviewer-added events within ±1s
- Same event name → `Deleted+Edited` (e.g. deleted a pass and re-tagged it correctly)
- Different event name → `Deleted+Added` (e.g. deleted a tackle and added a foul)
- Unpaired deletions → `Deleted` (standalone)
- Unpaired added events → `Added` (missed event)

### Rule 4: Location threshold
EUCLIDEAN_THRESHOLD = 5 units.
`dist = sqrt((nx-ox)² + (ny-oy)²)`
Only counts as error if dist > 5.

**Location payload paths:**
- `location`: `payload.location.actual.x` / `.y`
- `goal-location`: `payload['goal-location'].x` / `.y`

### Rule 5: Freeze Frame (shots only)
Only applied to `base.payload.name === 'shot'`.

**Player join:** by `playerId` (NOT index `id` field).
- Added Player: in reviewer FF but not collector FF
- Deleted Player: in collector FF but not reviewer FF
- Wrong Team: same playerId, different `groupIndicator`
- Wrong Location: same playerId, euclidean distance > 5 on `pitchPosition.default.x/y`

**Role resolution:** `roles.keeper/shooter/opponent` values are INDEXES.
`players[roleIndex].playerId` = actual player identity.
- Wrong Keeper: `resolveRole(cP.roles.keeper, cIndexMap) !== resolveRole(rP.roles.keeper, rIndexMap)`
- Same for Shooter and Opponent.

---

## Reviewer Detection

**Primary signal:** highest telemetry `event-activation` view count.
**Tie-break:** must have at least 1 amendment (not a pure playthrough).
**Exclude:** primary base collector (most base events, base > 100).
**Result:** single reviewer ID (top viewer only).

### Why NOT all viewers
Match 1294780 example:
- 1935: views=150, base=949 → Secondary Collector (NOT reviewer)
- 2909: views=23, amendments=0 → Playthrough viewer (excluded)
- 2119: views=1005 → Reviewer ✅

---

## Reviewed Count

`openedKeys` = unique event keys from reviewer's deduplicated telemetry.
Dedup: one telemetry record per `key+author` (latest capturedTime).

Match 1294780: 1005 unique keys reviewed by author 2119.
Coverage: 42% of 2375 base events (reviewer only checks their assigned categories).

---

## A/B/C Category Scores

Requires `capturedCats` from Tag Once's tracker button click.
Only available during live review. Shows `—` for completed matches.

**Category definitions (from Tag Once):**
- A: lineupsAndFormation, substitutions, tacticalShifts, playerOff, playerOn, goals,
     keyPassesBeforeShots, ownGoals, cards, fouls, offside, freeKickPass, corners,
     errors, kickOffs, throughBalls, stoppage, freezeFrame, pressuresBeforeShots,
     refereeBallDrop, endShots, g.K.-Actions-shots
- B: Clearances, passRecoveries, interceptions, blocks, dribbles, tackles, miscontrols,
     g.K.-Actions-Other, shields, fiftyFifty
- C: ballRecovery, aerialLosts, pressures
- Others: everything not in A/B/C

---

## Pending / Open Questions

1. **Score denominator alignment:** MARK's denominators run ~3–7% higher than the
   Analysis Team's reference for match 1294780. MARK shows 96%, team shows similar
   but different viewed counts. Needs direct reconciliation with Analysis Team.

2. **capturedCats storage:** Currently only available during live review.
   Should be stored in Firestore at review time to make A/B/C available later.

3. **Apollo cache dedup:** deduped=9116 for match 1294780 (should be ~2500).
   Error counts are correct despite this. Root cause under investigation.

