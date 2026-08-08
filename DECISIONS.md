# MARK — Decision Log

A record of *why* MARK works the way it does — decisions taken, alternatives rejected,
investigations behind them. Read alongside CHANGELOG.md (what/when) and MARK_CONTEXT.md (how).

---

## 1–19. Previous decisions (unchanged)
See git history for decisions 1–19 covering: audit redesign, keyboard shortcuts,
file ops, versioning, identity detection, module scores, bridge disconnect fix,
refinements from bridge, A/B/C deferral, semantic versioning.

---

## 20. Error Engine — 5-Rule System (v7.8.x, confirmed 2026-07-28)

**Match tested:** Saint-Étienne vs. Angers, 1st Half (matchId 1294780)
**Authors:** 3416 = Main Collector, 1935 = Secondary Collector, 2119 = Reviewer, 2909 = Playthrough (excluded)

### Rule 1 — Self-edits excluded
Reviewer amending their own added events = not collector errors.
`reviewerAddedKeys` set built from base events authored by reviewer.

### Rule 2 — Same value excluded
`JSON.stringify(oldRef?.payload) === JSON.stringify(latestAmend?.payload)` → skip.

### Rule 3 — Deleted+Added / Deleted+Edited
Pair deletion + added event within ±1000ms (PAIR_TOLERANCE_MS).
Different name → `Deleted+Added`. Same name → `Deleted+Edited`.

### Rule 4 — Location threshold (euclidean > 5 units)
`location` module: `payload.location.actual.x/y`
`goal-location` module: `payload['goal-location'].x/y`

### Rule 5 — Freeze Frame (shots only)
Join players by `playerId`. Roles = indexes into players array → resolve first.
Error types: Wrong Keeper, Wrong Shooter, Wrong Opponent, Added/Deleted Player, Wrong Team, Wrong Location.

**Confirmed:** computedErrors: 41–43, computedFFErrors: 1, Overall: 96%

---

## 21. Apollo Cache Deduplication (v7.8.1+, confirmed 2026-07-28)

Cache inflation: match 1294780 showed 10,051 events when true count is ~2,500.
Strategy: base=one per key; telemetry=one per key+author (latest CT); amendment/refinement=one per key+type+author (latest CT).

---

## 22. Reviewer Detection — Top Viewer Only (v7.8.x)

Reviewer = author with HIGHEST views who is NOT primary collector AND has amendments.
Only ONE reviewer. 1935 is secondary collector (base events > 0 despite views=150).

---

## 23. Reviewed Count = Telemetry Viewed Keys (confirmed 2026-07-28)

1005 unique events viewed by reviewer 2119 on match 1294780.
Coverage: 42% of 2375 base events. Reviewer only checks assigned categories.

---

## 24. Speed Metric Definitions (confirmed 2026-07-28, updated 2026-08-08)

**Gap threshold:** 5 minutes (GAP_MS = 5 * 60 * 1000)

**Module windows (confirmed via console testing):**
| Module | Window definition | Notes |
|--------|-------------------|-------|
| Base+Extras | Main: half-start→half-end capturedTime; Secondary: first→last base event capturedTime | Includes extras refs/amends |
| Pressure | first→last pressure base event | pressure-start/end only |
| Players | first→last players ref/amend | |
| Location | first→last location ref/amend | 1935 did 0 location on match 1294780 |
| Freeze-frame | first→last FF+goal-location+impact ref/amend | Very sparse, multi-day normal |

**Multi-day handling:** 1935 worked Dec 30→Dec 31 on match 1294780.
18-hour overnight gap excluded by 5-min gap rule. Active time correct at 2h 1m.

**Session exclusion rule:** Sessions (groups of events between 5-min gaps) with 0 base AND 0 extras
are excluded from base+extras active time. Pure-refinement sessions don't count toward base speed.

**Confirmed numbers (match 1294780, half 1):**
| Module | Main (3416) | Secondary (1935) | Overall Half |
|--------|-------------|------------------|--------------|
| Base+Extras | 2h 40m / 735/hr | 2h 1m / 650/hr | 4h 41m / 699/hr |
| Pressure | 30m 59s / 385/hr | 22m 56s / 217/hr | 53m 56s / 314/hr |
| Players | 1h 41m / 515/hr | 1h 13m / 780/hr | 2h 55m / 627/hr |
| Location | 1h 11m / 737/hr | N/A (0 events) | 1h 11m / 737/hr |
| Freeze-frame | 34m 3s / 79/hr | 23m 3s / 107/hr | 57m 6s / 90/hr |

---

## 25. Collector Self-Corrections Are NOT Reviewer Errors (confirmed 2026-07-28)

3416: 1528 total self-amendments. 1935: 310 total self-amendments.
Only reviewer (2119) amendments count as errors.

---

## 26. Freeze Frame Payload Structure (confirmed 2026-07-28)

`roles.keeper/shooter/opponent` = INDEXES into players array, not playerIds.
Must resolve: `players[roles.keeper[0]].playerId`.

---

## 27. Completeness Check — required-partials (confirmed 2026-08-08)

Tag Once stores `required-partials` field in base event payload.
Lists which modules each event requires (players, location, extras, goal-location, clocks).
`clocks` is always ignored (metadata, not collectible).

**Confirmed completeness numbers (match 1294780, half 1):**
| Module | Main 3416 | Secondary 1935 | Combined |
|--------|-----------|----------------|---------|
| players | 59.9% ⚠️ | 93.0% ✅ | 73.6% |
| location | 60.3% ⚠️ | 0.0% ❌ | 35.5% |
| extras | 99.1% ✅ | 93.4% ✅ | 96.7% |
| goal-location | 57.1% ⚠️ | 90.0% ✅ | 70.8% |

---

## 28. A/B/C Score Methods (confirmed 2026-08-08)

**Live review:** Tracker button IPC tap → `openQualityReviewToolWindow` → `categorizedEvents`
**Completed matches:** Static event name → group mapping (0 unmapped on match 1294780)

Static mapping confirmed:
- A: shot, end-shot, goal-keeper, card, foul-committed, stoppage, end-stoppage, referee-ball-drop, out, camera-on, camera-off
- B: clearance, interception, block, dribble, tackle, miscontrol, shield, fifty-fifty, hold-up-duel, positioning-duel, leg-stretch-duel, separation-duel
- C: ball-recovery, pressure-start, pressure-end
- Others: pass, reception, unknown-pass-end, everything else

**Confirmed scores (match 1294780):** A=82%, B=94%, C=97%, Others=98%

---

## 29. Half Quality Score (confirmed 2026-08-08)

**Definition:** errors / total collector base events (not just reviewed events)
**Denominator:** all base events by collector, excluding those deleted by anyone
**Numerator:** unique error keys from 5-rule engine attributed to that collector
**Formula:** `(denominator - errors) / denominator × 100`

**Confirmed (match 1294780):**
- Collector 3416: denominator=1284, errors=34, score=97.6% (MARK shows 97%)
- Collector 1935: denominator=947, errors=0, score=100%
- Combined: 1284 events

**Decision: collector-to-collector deletions NOT excluded from denominator.**
When 3416 deleted 886 of 1935's events, those 886 still count toward 1935's denominator.
Reason: 1935 did the work, it counts regardless of whether 3416 cleaned it up.

---

## 30. Validation Error Replication from Apollo Cache (confirmed 2026-08-08)

**Investigation:** Tried to find validation error history in Tag Once.
**All locations checked — no history found:**
- Apollo cache: ValidationLog objects computed on-demand, not persisted
- localStorage/sessionStorage: no validation data
- IndexedDB: only Firebase auth
- File system (AppData): no validation logs
- All 19 IPC channels: no history payload
- React fiber tree: no validation state
- Network calls: zero network calls during validation (purely local)
- Electron remote: not available

**Key finding:** `openValidationWindow` IPC channel = errors exist.
If only `validationApiResponse` fires with `currentState: loaded` → 0 errors.

**Confirmed replication rule (matches Tag Once exactly):**
```javascript
// validation errors = non-deleted base events where required-partials has missing refinements
const deletedKeys = new Set(halfEvents.filter(v=>v.category==='amendment'&&v.type==='deletion').map(v=>v.key))
baseHalf.forEach(v => {
  if (deletedKeys.has(v.key)) return  // CRITICAL: skip deleted events
  const required = (v.payload?.['required-partials']||[]).filter(p=>p!=='clocks')
  const missing = required.filter(m => !refinementMap[v.key]?.has(m))
  // missing.length > 0 = validation error
})
```

**Confirmed on:**
- Match 1444657 half 1: computed=0, live IPC=0 → ✅ PERFECT MATCH
- Match 1294780 half 1: computed=418 events with errors, live IPC=977 errors (different count
  because 1294780 was not fully clean — 418 unique events, 977 = total missing partial instances)

**Why 229 vs 0 discrepancy (resolved):**
First attempt showed 229 computed vs 0 live on match 1444657.
Root cause: we weren't filtering out deleted events from the denominator.
After adding `deletedKeys` filter: 229 → 0. Perfect match.

---

## 31. Productivity Formula (decided 2026-08-08, NOT YET BUILT)

**Formula:** total completed module-halves / 12
- 6 modules × 2 halves = 12 total units = 1.0 productivity
- Each module in each half = 1 unit if ≥95% complete, 0 if <95%
- Validation = binary: 0 errors = 1 unit, any errors = 0 units
- Pressure: binary — collector has pressure events in this half = done

**6 modules:**
1. Base+Extras (extras completion ≥95%)
2. Pressure (collector tagged pressure events in this half)
3. Players (players completion ≥95%)
4. Location (location completion ≥95%)
5. Freeze-frame (goal-location completion ≥95%, fallback: freeze-frame refs exist)
6. Validation (0 validation errors)

**Examples:**
- 6 modules done in half 1 only = 6/12 = 0.5
- 6/6 half 1 + 3/6 half 2 = 9/12 = 0.75
- All 12 = 12/12 = 1.0

**Status: Console snippet confirmed working (see PRODUCTIVITY_RESEARCH.md). Not yet in bridge or AuditDashboard.**

