# MARK — Changelog

All versions follow semantic versioning. Each version bump requires ALL 5 files to be updated:
`package.json`, `Cargo.toml`, `tauri.conf.json`, `bridge_script.js`, `main.rs` (ASAR_MARKER).

---

## [7.8.11] — 2026-08-08

### Added
- **Bridge computes `speedData` per collector per module** — sent in `qaResultsResponse`
- Modules: `baseExtras`, `pressure`, `players`, `location`, `freezeFrame`
- Each module: `{ activeMs, totalEvents, speedPerHour, completionRate, scenario, windowMethod, multiDay }`
- Base+Extras window: half-start→half-end for main collector, first→last base for secondary
- All modules: 5-min gap exclusion applied
- Completion % per module computed from `required-partials` vs refinements (excluding clocks)

---

## [7.8.10] — 2026-08-08

### Fixed
- **Main/secondary collector order wrong** — bridge now sorts `collectorIds` by:
  1. Has `half-start` + `half-end` anchors → goes first (main)
  2. Then by base event count descending
- **Show HR code + name** instead of raw Tag Once author ID in collector panels
- **Errors table** now shows HR code in collector column

---

## [7.8.9] — 2026-08-08

### Fixed
- **`REVIEW_GROUPS is not defined` crash** — restore `REVIEW_GROUPS` and `filterAmendments`
  constants deleted in v7.8.7 refactor (they lived between QuickSummary and AmendmentsTable)

---

## [7.8.8] — 2026-08-08

### Fixed
- **`computeErrorKeys is not defined` crash** — restore `computeErrorKeys`, `calcGroupScore`,
  `calcEventTypeScores` deleted in v7.8.7 refactor

---

## [7.8.7] — 2026-08-08

### Added — AuditDashboard redesign (replaces QuickSummary + ModuleScores)
New layout with 4 rows:
1. **6 score cards**: Overall | Half Quality | A | B | C | Others (68px rings)
2. **Collector panels**: Main (large, prominent) + Secondary (compact 280px, de-emphasized)
   - Both show: total active time first, then per-module breakdown with speed + completion badge
   - Secondary at reduced opacity with smaller text
3. **Errors table**: Always visible, first 5 rows + "Show all N →" expand button, click-to-seek
4. **Stats bar**: REVIEWED · ERRORS · HALF TOTAL · UP TO · amendment badges · Full Report

---

## [7.8.6] — 2026-08-08

### Added
- **A/B/C static mapping fallback** for completed matches (no `capturedCats` from tracker button)
- Confirmed 0 unmapped events on match 1294780 (31 event types, all covered)
- Static groups: A (shot/card/foul/keeper/stoppage...), B (clearance/block/dribble/tackle...),
  C (ball-recovery/pressure-start/pressure-end), Others (pass/reception/unknown-pass-end)
- Sets `staticMapping: true` flag on `reviewGroupScores` so UI can identify the method

---

## [7.8.5] — 2026-08-08

### Fixed
- **Black screen crash** — `React.useState` → `useState` in `QuickSummary`
  (React not default-imported; only named exports available)

---

## [7.8.4] — 2026-08-08

### Added
- **Half Quality Score** computed in bridge, sent in `qaResultsResponse` as `halfQualityScores`
- Combined score + per-collector breakdown
- Denominator: all base events by collector, excluding deleted-by-anyone
- Numerator: unique error keys attributed to that collector
- UI: 6th score card "Half Quality" (amber #FF9F0A) next to Overall
- Per-collector breakdown section (collapsed by default, click to expand, only when 2+ collectors)
- Stats bar now shows HALF TOTAL count

---

## [7.8.3] — 2026-08-04

### Fixed — Error Engine (bridge_script.js)
Two critical fixes to `latestCollectorRef` and `latestReviewerAmend`:

1. **`latestCollectorRef`** now includes collector `amendment` records alongside `refinement`
   records — sorted by `capturedTime` ascending, returns last. Collector self-corrections
   (amendments) are now correctly treated as final collector state.

2. **`latestReviewerAmend`** — new helper: only reviewer amendments with `capturedTime`
   strictly AFTER collector's last save count as errors.

Both fixes also applied to freeze-frame (`latestCollectorFF`, `latestReviewerFF`).

**Confirmed fix on:**
- Key `5a535442`: was missed Wrong Player error → now correctly detected
- Key `5bfdc828`: was missed Wrong Player error → now correctly detected
- Key `b3c2236e`: confirmed 3 errors (Wrong Extras, Wrong Player, Wrong Opponent)

---

## [7.8.2] — 2026-07-28

### Added
- A/B/C scores via tracker button IPC tap (`openQualityReviewToolWindow`)
- `reviewGroupScores` sent in `qaResultsResponse`
- Recalculated using 5-rule error keys after error engine runs
- A/B/C null on completed matches (tracker button sends no payload — known limitation)

---

## [7.8.1] — 2026-07-28

### Fixed
- Apollo cache deduplication strategy confirmed and hardened
- Base: one per key; telemetry: one per key+author (latest capturedTime);
  amendment/refinement: one per key+type+author (latest capturedTime)

---

## [7.8.0] — 2026-07-28

### Added
- Full 5-rule error engine in bridge (see DECISIONS.md §20)
- `computedErrors[]` and `computedFFErrors[]` in `qaResultsResponse`
- Reviewer detection: top telemetry viewer with amendments, not a collector
- Collector detection: COLLECTOR_WORK_MIN = 600 (base + refinement records)
- Score recalculation using accurate error keys

---

## [7.5.x] — 2026-07-11 (Previous session)

See git history for v7.5.20–7.5.25 covering:
- AmendmentsTable full rewrite (reviewer-only error rule)
- Bridge sends refinements map
- eventTypeScores, player resolution, teamMap fixes
- CSV export 15-column format

