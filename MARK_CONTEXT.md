# MARK — Full Context
**Version:** 7.8.11
**Last updated:** 2026-08-08
**Status:** Active — in use by Hudl Egypt reviewers.

---

## Repos & Tokens

| Resource | Value |
|----------|-------|
| MARK repo | https://github.com/ahmedashraf-cyber/mark-app |
| FIELD repo | https://github.com/ahmedashraf-cyber/flowops |
| GitHub token | Ask Ahmed — regenerated per session |
| Firebase project | `hudl-training-ops` |
| Firebase API key | `AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U` |
| Google Sheets API key | `AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI` |
| Matches Sheet ID | `1zoh7CmoQKPMLGBEklHXznG1Y8xBS-iuu0phRWn8-wXc` |
| Interview Sheet ID | `190Zih7R1HswY2yVxl4WanfH-QhGlt4X8bOBteFrNtiY` |

---

## Session Setup (Every Session)

```bash
cd /home/claude
git clone https://ahmedashraf-cyber:TOKEN@github.com/ahmedashraf-cyber/mark-app.git mark_review2
cd mark_review2
git config user.email "ahmed.ashraf@hudl.com"
git config user.name "Ahmed Ashraf"
```

**Version bump rule — ALL 6 files must match:**
1. `package.json` → `"version": "X.Y.Z"`
2. `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
3. `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"` + `"title": "MARK X.Y.Z — Review App"`
4. `src-tauri/src/bridge_script.js` → `const BRIDGE_VERSION = 'X.Y.Z'`
5. `src-tauri/src/main.rs` → `const ASAR_MARKER: &str = "<!-- MARK_BRIDGE_INJECTED vX.Y.Z -->"`
6. `src/hooks/useUpdateCheck.js` → `export const CURRENT_VERSION = 'X.Y.Z'`

**CRITICAL:** ASAR_MARKER must ALWAYS be bumped. Bridge won't reinject if marker matches.
**After pushing:** wait for GitHub Actions green → install new `.exe` from Releases → re-embed bridge.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri 2 (Rust + WebView2, Windows only) |
| UI | React 19 + Tailwind CSS 3 |
| Design | Dark theme, `#E8590C` orange, Inter + DM Sans + JetBrains Mono |
| Auth | Firebase Auth — same trainer accounts as FIELD |
| Database | Firebase Firestore — same project as FIELD |
| Bridge | JS injected into Tag Once via ASAR patch → localhost WebSocket :9001 |
| Match data | Google Sheets API (live fetch on load) |
| Build CI | GitHub Actions → Windows runner → Tauri build → GitHub Release |

---

## Architecture: Bridge → MARK

```
Tag Once (Electron app)                    MARK (Tauri app)
┌─────────────────────────────────┐       ┌──────────────────────────┐
│  app.html (patched by MARK)     │       │  AuditPage.jsx           │
│  bridge_script.js injected      │ WS    │  useSync.js              │
│                                 │◄─────►│  localhost:9001          │
│  Apollo cache → extract()       │       │                          │
│  Error engine (5 rules)         │       │  AuditDashboard          │
│  Reviewer/collector detection   │       │  AmendmentsTable         │
│  Speed computation              │       │  FF errors table         │
│  Half Quality Score             │       │  CSV export              │
│  A/B/C static mapping           │       │  Save Audit button       │
└─────────────────────────────────┘       └──────────────────────────┘
```

**Bridge sends to MARK (qaResultsResponse):**
```javascript
{
  type: 'qaResultsResponse',
  matchId, bridgeVersion, videoTime,
  baseEvents[],          // reviewer-viewed base events
  amendments[],          // all amendments (all authors)
  refinements,           // map: key_type → payload
  collectorId,           // primary collector (back-compat)
  collectorIds[],        // all collectors, SORTED: main first (has half-start/end anchors), then by base count
  reviewerId, reviewerIds[],
  identities[],          // HR codes + names
  lineupPlayers[],       // home + away players with jersey numbers
  moduleScores,          // legacy per-module scores
  reviewGroupScores,     // A/B/C/Others scores (recalculated using 5-rule errors)
  computedErrors[],      // non-FF errors from 5-rule engine
  computedFFErrors[],    // freeze frame errors (shots only)
  halfQualityScores,     // { combined: {score,denominator,errors}, perCollector: {[id]: ...} }
  speedData,             // { [collectorId]: { baseExtras, pressure, players, location, freezeFrame } }
  diagnostics,           // debug info (universeBase, reviewed, telemetry, work, baseAuthors)
  usedTelemetry,
  environment,
  ts
}
```

---

## Error Engine — 5 Rules (v7.8.x)

See DECISIONS.md §20 for full details. Computed in bridge, pre-sent to MARK.

**Rule 1:** Self-edits excluded
**Rule 2:** Same value excluded
**Rule 3:** Deleted+Added / Deleted+Edited (±1000ms)
**Rule 4:** Location threshold (euclidean > 5 units)
**Rule 5:** Freeze Frame — shots only, join by playerId, resolve role indexes

---

## Collector Detection (v7.8.10+)

```javascript
const COLLECTOR_WORK_MIN = 600  // base + refinement records

// Detection: high base+refinement work
let collectorIds = [...allAuthors].filter(a =>
  ((baseAuthorCounts[a]||0) + (refinementCounts[a]||0)) > COLLECTOR_WORK_MIN
)

// Sort: main first (has half-start+half-end), then by base count descending
collectorIds.sort((a, b) => {
  const aHasAnchors = hasHalfStart(a) && hasHalfEnd(a)
  const bHasAnchors = hasHalfStart(b) && hasHalfEnd(b)
  if (aHasAnchors && !bHasAnchors) return -1
  if (!aHasAnchors && bHasAnchors) return 1
  return baseAuthorCounts[b] - baseAuthorCounts[a]
})
```

---

## Score Types

### Overall Score
`(reviewed - errors) / reviewed × 100`
- `reviewed` = unique keys from reviewer telemetry (deduped)
- `errors` = unique error keys from 5-rule engine

### Half Quality Score
`(denominator - errors) / denominator × 100`
- `denominator` = all base events by collector, excluding deleted-by-anyone
- `errors` = unique error keys attributed to that collector

### A/B/C Scores
- Live review: tracker button IPC (`openQualityReviewToolWindow`)
- Completed matches: static event name → group mapping
- A=shot/card/foul/keeper..., B=clearance/block/dribble/tackle..., C=ball-recovery/pressure

### Module Completeness (not a score, a % indicator)
- `(filled/requires) × 100` per module per collector
- Requires = events with that module in `required-partials`, non-deleted
- Filled = events with a refinement of that type
- Threshold for "done": ≥95%

---

## Speed Data Structure (v7.8.11+)

```javascript
speedData = {
  [collectorId]: {
    baseExtras: {
      activeMs, totalEvents, speedPerHour,
      completionRate,   // extras completion %
      scenario,         // 'base+extras' | 'base only' | 'extras only'
      windowMethod,     // 'half-start → half-end' | 'first → last base'
      multiDay,         // boolean
    },
    pressure:    { activeMs, totalEvents, speedPerHour, completionRate: null },
    players:     { activeMs, totalEvents, speedPerHour, completionRate },  // players %
    location:    { activeMs, totalEvents, speedPerHour, completionRate },  // location %
    freezeFrame: { activeMs, totalEvents, speedPerHour, completionRate },  // goal-location %
  }
}
```

---

## AuditDashboard Layout (v7.8.7+)

```
┌─────────────────────────────────────────────────────────────────┐
│  [Overall] [Half Quality] [A-Review] [B-Review] [C-Review] [Others]  ← 6 score cards
├──────────────────────────────────┬──────────────────────────────┤
│  MAIN COLLECTOR (large)          │  SECONDARY (compact 280px)   │
│  • HR code + name                │  • HR code + name            │
│  • Half Quality %                │  • Half Quality %            │
│  • Total active time (sum)       │  • Total active time         │
│  • Per-module breakdown:         │  • Compact module rows       │
│    Base+Extras  2h40m  735/hr    │                              │
│    Pressure     30m    385/hr    │                              │
│    Players      1h41m  515/hr 59.9% │                          │
│    Location     1h11m  737/hr 60.3% │                          │
│    Freeze-frame 34m    79/hr  57.1% │                          │
├──────────────────────────────────┴──────────────────────────────┤
│  ERRORS TABLE (always visible, first 5 rows, expand button)     │
│  TIME | EVENT | ERROR TYPE | MODULE | COLLECTOR | KEY           │
├─────────────────────────────────────────────────────────────────┤
│  STATS BAR: 1005 REVIEWED  41 ERRORS  1284 HALF TOTAL  [Report] │
└─────────────────────────────────────────────────────────────────┘
```

---

## Firestore Collections

### `mark_audit_sessions`
One document per audit. Deleted and recreated on re-audit (no duplicates).
Key fields: sessionId, matchId, half, reviewerId, collectorIds, qualityScore,
qualityScoreA/B/C, moduleScores, halfQualityScore (not yet saved), speedData (not yet saved).

### `mark_audit_amendments`
One document per reviewer amendment, linked via sessionId.
Key fields: key, type, originalName, author, capturedTime, videoTimestamp, payload.

---

## Known Limitations

| Limitation | Detail | Status |
|------------|--------|--------|
| Apollo cache dependency | Events not loaded into Tag Once = invisible to MARK | Known, ~0.08% miss rate |
| One reviewer per half | Top telemetry viewer only | By design |
| A/B/C null on completed | Tracker button sends no payload on completed matches | Fixed v7.8.6 (static mapping) |
| Half Quality Score not in Firestore | Computed but not saved to DB | Pending |
| Speed data not in Firestore | Computed but not saved to DB | Pending |
| `totalBaseEvents` in Firestore = reviewed | Should be total collector base events | Pending fix |
| Productivity not built | Formula confirmed, console tested, not in MARK yet | See PRODUCTIVITY_RESEARCH.md |
| Validation history not in Tag Once | Tag Once computes errors on-demand, no history | Confirmed after exhaustive search |

