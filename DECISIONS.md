# MARK — Decision Log

A record of *why* MARK works the way it does — the decisions taken, the
alternatives rejected, and the investigations behind them. Read alongside
[CHANGELOG.md](./CHANGELOG.md) (the *what/when*) and
[MARK_CONTEXT.md](./MARK_CONTEXT.md) (the *how*).

---

## 1–19. Previous decisions (unchanged)
See git history for decisions 1–19 covering: audit redesign, keyboard shortcuts,
file ops, versioning, identity detection, module scores, bridge disconnect fix,
refinements from bridge, A/B/C deferral, semantic versioning.

---

## 20. Error Engine — 5-Rule System (v7.8.x, confirmed 2026-07-28)

**Match tested:** Saint-Étienne vs. Angers, 1st Half (matchId 1294780)
**Authors confirmed:**
- 3416 = Main Collector (1416 base events, views=0)
- 1935 = Secondary Collector (949 base events, views=150 on 2025-12-31)
- 2119 = Reviewer (views=1005 on 2026-07-24)
- 2909 = Playthrough viewer (views=23 on 2026-07-27, no amendments → excluded)

### Rule 1 — Self-edits excluded
If the reviewer tagged a base event themselves (missed event), any amendments
they make on that same event are excluded. Not collector errors.

**Implementation:** Build `reviewerAddedKeys` set from base events authored by
reviewer. Filter out from `allReviewerAmends`.

### Rule 2 — Same value excluded
If reviewer's amendment payload === collector's original refinement payload
(old == new), it is NOT counted as an error. No noise from cosmetic saves.

**Implementation:** `JSON.stringify(oldRef?.payload) === JSON.stringify(latestAmend?.payload)` → skip.

### Rule 3 — Deleted+Added / Deleted+Edited
When reviewer deletes an event AND adds a new event within ±1000ms:
- Different event name → `Deleted+Added` (collector tagged wrong event type)
- Same event name → `Deleted+Edited` (collector tagged same event with wrong values)

**Tolerance:** 1000ms (PAIR_TOLERANCE_MS). Pair by closest timestamp match.

### Rule 4 — Location threshold (euclidean distance > 5)
For `location` module: `payload.location.actual.x/y`
For `goal-location` module: `payload['goal-location'].x/y`
Only counts as error if euclidean distance between collector and reviewer coordinates > 5 units.

### Rule 5 — Freeze Frame (shots only)
- Only applied to events with `base.payload.name === 'shot'`
- Latest collector FF = latest `refinement/freeze-frame` by non-reviewer (any category)
- Latest reviewer FF = latest `amendment/freeze-frame` by reviewer
- Join players by `playerId` (NOT index `id` field)
- Roles (keeper/shooter/opponent): values in `roles.keeper` etc. are INDEXES into players array → resolve to `playerId` via `players[index].playerId`
- Player position: `pitchPosition.default.x/y`
- Group/team: `groupIndicator` field (`TEAM_A`, `TEAM_B`, `REF`, `KEEPER`)
- Error types: Wrong Keeper, Wrong Shooter, Wrong Opponent, Added Player, Deleted Player, Wrong Team, Wrong Location (euclidean > 5 on matched players only)

### Confirmed numbers for match 1294780:
- computedErrors: 41–43 (non-FF)
- computedFFErrors: 1
- Overall score: 96% (1005 viewed, ~43 errors)

---

## 21. Apollo Cache Deduplication (v7.8.1+, confirmed 2026-07-28)

**Problem:** Tag Once accumulates duplicate events in Apollo cache when the same
match is loaded multiple times in a session. Match 1294780 showed 10,051 events
in cache when the true count is ~2,500.

**Deduplication strategy (confirmed working):**
```js
// base: one per key (first seen)
dk = 'base|' + v.key
// telemetry: one per key+author (latest capturedTime)
dk = 'tel|' + v.key + '|' + v.author
// amendment/refinement: one per key+type+author (latest capturedTime)
dk = category + '|' + key + '|' + type + '|' + author
```

After dedup: ~9116 events (still not ~2500 — being investigated).

**telemetryAll dedup** (separate from error engine dedup):
```js
dk = v.key + '|' + v.author  // keeps one telemetry record per event per viewer
```
This gives correct `openedKeys` count (1005 for reviewer 2119).

---

## 22. Reviewer Detection — Top Viewer Only (v7.8.x)

**Problem:** 1935 (secondary collector, views=150) and 2909 (playthrough, views=23)
were being included as reviewers alongside 2119 (views=1005).

**Rule confirmed:**
- Reviewer = author with HIGHEST views count who is NOT the primary collector AND has amendments
- Only ONE reviewer (the top viewer) — not all viewers
- 1935 is secondary collector (949 base events despite having views=150)
- 2909 is playthrough viewer (no amendments → excluded)

**Bridge implementation:**
```js
candidates.sort((a,b) => viewCounts[b] - viewCounts[a])
reviewerIds = [candidates[0]]  // top viewer only
```

**AuditPage implementation:**
```js
viewers.sort((a,b) => (b.views||0) - (a.views||0))
const topViewer = viewers[0]
if (!isPrimaryCollector) trueReviewerIds.push(Number(topViewer.author))
```

---

## 23. Reviewed Count = Telemetry Viewed Keys (v7.8.x, confirmed 2026-07-28)

**Confirmed correct number for match 1294780:** 1005 unique events viewed by reviewer 2119.

**Why NOT 736:** Earlier test was on a partially loaded cache. Full cache has 2375 base events.
**Why NOT 1122:** telemetryAll was not deduplicated, including 1935 (150 views) in openedKeys.
**Why 1005 is correct:** All 1005 activations are on 2026-07-24 by author 2119 only.
Coverage: 42% of 2375 base events — reviewer only checks events in their assigned categories.

**Error rate validation:**
- Phase 1 (2:47–3:25 PM): 358 events, 17 errors, 4.7% error rate, 3.1s avg watch
- Phase 2 (3:41–4:03 PM): 647 events, 30 errors, 4.6% error rate, 1.3s avg watch
- Combined: 1005 events, 47 errors, 4.7% error rate, 1.9s avg watch
- 16-minute gap between phases = break

---

## 24. Speed Metric Definitions (confirmed 2026-07-28)

**Gap threshold:** 5 minutes (GAP_MS = 5 * 60 * 1000)
If any role abandons work for >5 minutes, that gap is excluded from active time.

**Collector tagging speed:**
- Use `capturedTime` of base events (first→last, excluding gaps >5min)
- Report per author separately (main collector vs secondary collector)
- Option A (base only) = pure tagging speed
- Option B (base + refinements) = collection work total
- Option C (all work) = full session including self-corrections
- **Recommended default: Option B** for total collection time

**Confirmed numbers for match 1294780 (Option B):**
| Author | Role | Active time | Events | Speed |
|--------|------|-------------|--------|-------|
| 3416 | Main Collector | 5:49:42 | 3711 | 637 ev/hr |
| 1935 | Secondary Collector | 3:53:20 | 2316 | 596 ev/hr |
| 2119 | Reviewer | 0:32:31 | 1005 | 1854 ev/hr |

**Reviewer speed:**
- Use `activatedAt` → `deactivatedAt` from telemetry payload
- Cap each event watch at 5 minutes (one event had 15.9min → capped to 5min)
- 1005 events deduped, 32:31 active, 1854 ev/hr
- Avg watch: 1.9s overall (4.8s for amended events, 2.5s for approved)

**Per-module speed (Option A, 5min gap, confirmed):**
| Module | Author | Records | Active | Speed |
|--------|--------|---------|--------|-------|
| players | 1935 | 816 | 1:13:57 | 662 ev/hr |
| location | 3416 | 761 | 1:05:46 | 694 ev/hr |
| extras | 1935 | 520 | 0:36:42 | 850 ev/hr |
| players | 3416 | 747 | 1:39:08 | 452 ev/hr |
| extras | 3416 | 759 | 2:56:42 | 258 ev/hr |
| freeze-frame | 1935 | 13 | 0:08:33 | 91 ev/hr · 39.5s/record |
| freeze-frame | 3416 | 14 | 0:19:43 | 43 ev/hr · 84.6s/record |

**Freeze-frame note:** gaps are inherently large (tied to shot events).
3416: median gap 285.5s between FF records.
1935: median gap 437.4s between FF records.
Speed metric is valid (Option A, 5min gap) but context matters.

**Reviewer amendment speed per module:**
| Module | Amendments | Active | Speed | Avg/rec |
|--------|-----------|--------|-------|---------|
| players | 18 | 20:57 | 52/hr | 69.9s |
| location | 9 | 5:09 | 105/hr | 34.4s |
| extras | 3 | 2:27 | 73/hr | 49.0s |
| freeze-frame | 4 | 2:12 | 109/hr | 33.2s |
| impact | 4 | 1:24 | 170/hr | 21.2s |
| goal-location | 2 | 2:32 | 47/hr | 76.1s |

---

## 25. Collector Self-Corrections Are NOT Reviewer Errors (confirmed 2026-07-28)

**Match 1294780 self-correction counts:**
- 3416: 1007 `amendment/deletion` + 198 `amendment/base` + 124 `amendment/players` + 117 `amendment/location` = 1528 total self-amendments
- 1935: 63 `amendment/deletion` + 82 `amendment/base` + 145 `amendment/players` = 310 total self-amendments

These are collectors fixing their own work during collection — NOT reviewer errors.
Only amendments authored by the reviewer (2119) count as errors in MARK's scoring.

---

## 26. Freeze Frame Payload Structure (confirmed 2026-07-28)

```js
payload.freezeFrame.players = [
  { id: 0,  // position INDEX (not player identity)
    playerId: 1049,  // actual player identity
    groupIndicator: 'TEAM_A',  // 'TEAM_A', 'TEAM_B', 'REF', 'KEEPER'
    pitchPosition: { default: { x: 45.2, y: 30.1 } }
  }, ...
]
payload.freezeFrame.roles = {
  keeper:   [3],  // array of INDEX values into players array
  shooter:  [7],
  opponent: [13]
}
```

**Critical:** roles values are player array INDEXES, not playerIds.
Must resolve: `players[roles.keeper[0]].playerId` to get actual player identity.

---

## 27. Reviewer Behaviour Analysis (confirmed 2026-07-28)

**Match 1294780 reviewer (2119) behaviour:**
- Total events reviewed: 1005
- Events with amendments (errors): 47 (4.7%)
- Events approved without amendment: 958 (95.3%)
- Events watched <2s: 905 (867 clean approvals, 38 errors caught despite fast view)
- Events with deactivation timestamp: 1005 (100% complete)
- One event had 15.9 min watch time (reviewer was distracted/paused)

**Two-phase review pattern:**
- Phase 1 (careful): 358 events, 3:25 PM cutoff, 4.7% error rate, 3.1s avg watch
- Phase 2 (fast): 647 events, starts 3:41 PM, 4.6% error rate, 1.3s avg watch
- Quality is consistent across both phases — reviewer not cutting corners in Phase 2

---

## 28. Metadata Events in Apollo Cache (observed 2026-07-28)

Author 2119 has `metadata/metadata: 50` events in the cache.
These are NOT amendments or refinements. They appear to be Tag Once's internal
review completion markers (e.g. `qaIsReviewed = true`).
MARK currently ignores these — they should NOT be counted in any error or speed metric.

