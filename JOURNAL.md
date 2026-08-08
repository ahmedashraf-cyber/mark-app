# MARK — Development Journal

Chronological log of sessions, decisions, and findings.

---

## Session 2026-08-08 — Quality Scores, Speed, Completeness, Productivity Research

### What We Built

**v7.8.4 — Half Quality Score**
- Bridge computes `halfQualityScores` (combined + per-collector)
- Denominator: all collector base events excluding deleted-by-anyone
- Confirmed: 3416=97.6%, 1935=100% on match 1294780
- UI: 6th score card in QuickSummary (amber color)
- Bug: `React.useState` crash → fixed in v7.8.5

**v7.8.6 — A/B/C Static Mapping**
- Problem: completed matches → tracker button fires but no `categorizedEvents` payload
- Confirmed via console: `openQualityReviewToolWindow` fires with `payload keys: none`
- Solution: static event name → group mapping, 0 unmapped events on match 1294780
- A/B/C scores now work on all matches

**v7.8.7 — AuditDashboard redesign**
- Full redesign of audit results page
- 3 mockup versions shown, V1 "Command Center" selected with 3 fixes:
  1. Sum row (total active time) shown before module breakdown
  2. Secondary collector de-emphasized (smaller, reduced opacity)
  3. Errors table always visible
- Multiple crashes fixed (v7.8.7 → v7.8.9): deleted 3 functions with old QuickSummary block

**v7.8.10 — Collector ordering + HR codes**
- Main/secondary was reversed (1935 showing as main, 3416 as secondary)
- Bridge now sorts collectorIds: half-start/end anchors first, then by base count
- Panels now show HR code + name (e.g. "10086208 — Mohamed Abdallah") instead of raw IDs
- Errors table shows HR code in collector column

**v7.8.11 — Speed data in bridge**
- Bridge computes full `speedData` per collector per module
- 5-min gap exclusion, session exclusion for non-base+extras sessions
- completionRate per module computed from required-partials vs refinements
- AuditDashboard reads `results.speedData` — speed rows now populate

### Speed Investigation (Console)

Exhaustive investigation of speed calculation for match 1294780:

**Base+Extras module:**
- Main (3416): half-start→half-end window = 2h 40m, 0 gaps, 735/hr
- Secondary (1935): first→last base = 2h 1m active (overnight gap excluded), 650/hr
- Both: base+extras only, pressure excluded, pure-refinement sessions excluded

**Pressure module:**
- 3416: 30m 59s, 199 events, 385/hr
- 1935: 22m 56s, 83 events, 217/hr
- Overall: 53m 56s, 282 events, 314/hr

**Players module:**
- 3416: 1h 41m (1 gap of 114min excluded), 871 events, 515/hr
- 1935: 1h 13m (1 gap of 39.5min excluded), 961 events, 780/hr
- Overall: 2h 55m, 1832 events, 627/hr

**Location module:**
- 3416: 1h 11m (3 gaps excluded), 878 events, 737/hr
- 1935: N/A — 0 location events
- Overall = 3416 only

**Freeze-frame module (FF + goal-location + impact):**
- 3416: 34m 3s (9 sessions), 45 events, 79/hr
- 1935: 23m 3s (15 sessions, ⚠️ multi-day), 41 events, 107/hr
- Overall: 57m 6s, 86 events, 90/hr

### Completeness Investigation (Console)

Using `required-partials` field from base event payload:
- `clocks` partial type → always ignored
- Event types confirmed: camera-off has no required-partials, pressure-end has none, shot requires players+extras only

**Confirmed numbers (match 1294780, half 1):**
- players: 3416=59.9%⚠️, 1935=93.0%✅, combined=73.6%
- location: 3416=60.3%⚠️, 1935=0.0%❌, combined=35.5%
- extras: 3416=99.1%✅, 1935=93.4%✅, combined=96.7%
- goal-location: 3416=57.1%⚠️, 1935=90.0%✅, combined=70.8%

### Validation System Investigation

**Goal:** Find validation error history for productivity calculation.

**Tag Once Error Check button:** Opens Validation Window with current errors.
Match 1294780: 977 errors (964 partial field missing, 8 FF incomplete, 2 post-phase, etc.)

**IPC architecture confirmed:**
- Button click → `openValidationWindow` fires with errors array
- Clean match → only `validationApiResponse` fires (no `openValidationWindow`)
- `requestValidationData` → returns `{}`
- `runValidation` → returns `{}`

**History search — 9 locations checked, all empty:**
Apollo cache, localStorage, sessionStorage, IndexedDB, AppData files,
React fiber, window globals, network calls, all 19 IPC channels.

**Key discovery — cache replication:**
Tag Once's validation rule: `non-deleted base events where required-partials has missing refinements`
Confirmed perfect match on match 1444657 (computed=0, IPC=0 ✅).
229 → 0 after adding deleted event exclusion.

**Conclusion:** No history exists. Binary only: 0 errors = done, any errors = not done.

### Productivity Formula

**Decided:** 6 modules × 2 halves = 12 units = 1.0 productivity
- ≥95% completion = 1 unit, <95% = 0 unit (no partial credit)
- Validation: binary (0 errors = 1, any = 0)
- Pressure: binary (has events in half = done)

**Console tested on match 1444657 half 1:**
- Collector 2523 (main): base+extras✅, pressure✅, players❌(92%), location❌(91%), FF❌(73%), validation✅
- Result: 3/6 = 3/12 = 0.25 of full match

**NOT YET BUILT into MARK.** See PRODUCTIVITY_RESEARCH.md for action items.

---

## Session 2026-07-28 — Error Engine Validation

- 5-rule error engine confirmed via console on match 1294780
- Reviewer detection: top telemetry viewer only
- Collector detection: COLLECTOR_WORK_MIN=600
- Speed metrics preliminary investigation
- Half Quality Score design discussion

---

## Session 2026-07-11 — AmendmentsTable Rewrite

- Reviewer-only error rule confirmed
- AmendmentsTable full rewrite (8 columns)
- Bridge sends refinements map
- Player resolution 3-layer fallback
- CSV export 15-column format

