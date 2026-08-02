# MARK — Full Context
**Version:** 7.8.2
**Last updated:** 2026-07-28
**Status:** Active — in use by Hudl Egypt reviewers. Error engine v7.8.x deployed.

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
git clone https://ahmedashraf-cyber:TOKEN@github.com/ahmedashraf-cyber/mark-app.git mark_push
cd mark_push
git config user.email "ahmed.ashraf@hudl.com"
git config user.name "Ahmed Ashraf"
```

**Version bump rule — ALL 5 files must match:**
1. `package.json` → `"version": "X.Y.Z"`
2. `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
3. `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"` + `"title": "MARK X.Y.Z — Review App"`
4. `src-tauri/src/bridge_script.js` → `const BRIDGE_VERSION = 'X.Y.Z'`
5. `src-tauri/src/main.rs` → `const ASAR_MARKER: &str = "<!-- MARK_BRIDGE_INJECTED vX.Y.Z -->"`

**CRITICAL:** ASAR_MARKER must ALWAYS be bumped with every version. If Tag Once
already has the old marker in app.html, the new bridge will never be injected.

**After pushing:** wait for GitHub Actions green → install new `.exe` from Releases.

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
│  Error engine (5 rules)         │       │  QuickSummary (scores)   │
│  Reviewer/collector detection   │       │  AmendmentsTable         │
│  Telemetry dedup                │       │  FF errors table         │
│  Score recalculation            │       │  CSV export              │
└─────────────────────────────────┘       └──────────────────────────┘
```

**Bridge sends to MARK (qaResultsResponse):**
- `baseEvents[]` — viewed base events (reviewer's openedKeys)
- `amendments[]` — all amendments (all authors)
- `refinements` — map of key_type → payload
- `collectorId`, `collectorIds`, `reviewerId`, `reviewerIds`
- `identities[]` — HR codes + names from EventHistory sweep
- `lineupPlayers[]` — home + away players with jersey numbers
- `moduleScores` — legacy module score breakdown
- `reviewGroupScores` — recalculated A/B/C/Others scores (uses 5-rule errors)
- `computedErrors[]` — non-FF errors from 5-rule engine
- `computedFFErrors[]` — freeze frame errors (shots only)
- `diagnostics` — debug info

---

## Error Engine — 5 Rules (v7.8.x)

Computed in bridge, pre-sent to MARK. All 5 rules confirmed via console testing
on match 1294780 (Saint-Étienne vs. Angers, 1st Half).

**Rule 1:** Self-edits excluded — reviewer amending their own added events = not errors
**Rule 2:** Same value excluded — old payload == new payload = not an error
**Rule 3:** Deleted+Added / Deleted+Edited — pair deletions with added events within ±1s
  - same event name = `Deleted+Edited`
  - different event name = `Deleted+Added`
**Rule 4:** Location threshold — euclidean distance > 5 units only
  - `location`: `payload.location.actual.x/y`
  - `goal-location`: `payload['goal-location'].x/y`
**Rule 5:** Freeze frame (shots only) — join by `playerId`, resolve roles by index

**Key deduplication** (Apollo cache inflation fix):
```js
base:       dk = 'base|' + key              // one per key
telemetry:  dk = 'tel|' + key + '|' + author // one per key+author
amendments: dk = category+'|'+key+'|'+type+'|'+author
```

**Confirmed numbers for match 1294780:**
- computedErrors: 41–43 | computedFFErrors: 1 | overall: 96%
- Reviewed: 1005 events | Errors: 43 | Score: 96%

---

## Reviewer Detection

**Rule:** Reviewer = author with highest telemetry views who is NOT the primary
collector AND has at least 1 amendment. Only the TOP viewer qualifies.

**Bridge:**
```js
candidates.sort((a,b) => viewCounts[b] - viewCounts[a])
reviewerIds = candidates.length > 0 ? [candidates[0]] : []
```

**AuditPage (client-side fallback):**
```js
viewers.sort((a,b) => (b.views||0) - (a.views||0))
const topViewer = viewers[0]
const isPrimaryCollector = topViewer.author === topBaseAuthor.author && topViewer.base > 100
if (!isPrimaryCollector) trueReviewerIds.push(Number(topViewer.author))
```

**Match 1294780 example:**
- 3416: views=0, base=1416 → Main Collector
- 1935: views=150, base=949 → Secondary Collector (NOT reviewer despite having views)
- 2909: views=23, amendments=0 → Playthrough viewer (excluded)
- 2119: views=1005 → **Reviewer** ✅

---

## Score Calculation

**Overall:** `(viewed - errors) / viewed * 100`
**A/B/C/Others:** requires `capturedCats` from tracker button click during live review
**noCats:** when tracker button not found (completed match), only Overall is shown

**Viewed count:** unique event keys from reviewer's deduplicated telemetry
- Dedup: one record per `key+author` (latest capturedTime)
- Match 1294780: 1005 unique keys (confirmed correct)

**Error keys:** unique event keys from computedErrors + computedFFErrors
- Does NOT use raw amendment count (would include collector self-corrections)
- Does NOT use all viewer telemetry (would include playthrough viewers)

---

## WebSocket Timeout

`useSync.js` timeout for `qaResultsResponse`: **30 seconds**
(increased from 8s to handle large matches with many events)

---

## Freeze Frame Payload Structure

```js
payload.freezeFrame = {
  players: [
    { id: 0,           // position INDEX (not player identity)
      playerId: 1049,  // actual player identity — use this for comparison
      groupIndicator: 'TEAM_A',  // TEAM_A, TEAM_B, REF, KEEPER
      pitchPosition: { default: { x: 45.2, y: 30.1 } }
    }
  ],
  roles: {
    keeper:   [3],   // INDEX into players array (NOT playerId)
    shooter:  [7],
    opponent: [13]
  }
}
```

**Resolve role:** `players[roles.keeper[0]].playerId`
**Error types:** Wrong Keeper/Shooter/Opponent (role changed), Added/Deleted Player,
Wrong Team (groupIndicator changed), Wrong Location (euclidean > 5, matched players only)

---

## Speed Metrics (confirmed 2026-07-28)

**Gap threshold:** 5 minutes — gaps >5min excluded from active time calculation

**Match 1294780 confirmed speeds:**

| Role | Author | Active time | Speed |
|------|--------|-------------|-------|
| Main Collector | 3416 | 5:49:42 (base+refs) | 637 ev/hr |
| Secondary Collector | 1935 | 3:53:20 (base+refs) | 596 ev/hr |
| Reviewer | 2119 | 0:32:31 (watch time) | 1854 ev/hr |

**Per-module speeds** — see DECISIONS.md #24 for full table.

**Reviewer two-phase pattern:**
- Phase 1 (2:47–3:25 PM): careful review, 358 events, 3.1s avg watch
- Phase 2 (3:41–4:03 PM): fast approval, 647 events, 1.3s avg watch
- Error rate consistent across both phases (~4.7%)

---

## Pending Work (as of 2026-07-28)

1. **Apollo cache dedup** — deduped count is 9116 not ~2500. Root cause unclear.
   The error engine still produces correct results (41-43 errors) because the
   dedup strategy correctly handles amendments/refinements per key+type+author.
   The 9116 vs 2500 discrepancy needs further investigation.

2. **A/B/C scores** — show `—` for completed matches (tracker button not found).
   Only works during live review when the tracker button is available.
   Consider capturing `capturedCats` during the review session and storing in Firestore.

3. **Speed metrics in UI** — speed per role per module is confirmed from console
   testing but not yet displayed in MARK's UI. Awaiting permission to build.

4. **FIELD pending roles** — Training Supervisor and Trainee roles not yet built.

5. **Score denominator alignment** — MARK's denominators run ~3–7% higher than
   the Analysis Team's reference. Reconciliation pending direct collaboration
   with the Analysis Team.

---

## Known Issues

| Issue | Status | Details |
|-------|--------|---------|
| deduped=9116 | Open | Should be ~2500. Error engine still correct. |
| A/B/C empty on completed matches | By design | Need capturedCats from live session |
| 1935 tagging dates (Dec 2025) | By design | Match was re-tagged months later |
| blueprint-icons font 404s | Cosmetic | Tag Once fonts not in MARK's bundle |

