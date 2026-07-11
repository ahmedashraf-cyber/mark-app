# MARK — Session Journal

---

## Session: 2026-07-11 — v7.5.20 → v7.5.28 (9 builds)

### Context
Deep investigation and rebuild of the entire audit scoring and errors table system.
Test match used throughout: **Moss vs Sandnes**, match ID `1436691`, 1st half.
Three people on this half: Alaa (base collector), Mohamed (specialist), Omar (reviewer).

---

### Part 1 — Confirming the Error Rule

**Question being tested:** What exactly counts as an error in an audit?

Previous MARK logic counted any amendment by anyone who wasn't the base author as an error. This was wrong.

**Console testing process:**
1. Loaded `docFull2` GraphQL query to get full EventHistory per event key
2. Iterated through all amendment keys in the half
3. For each amendment: compared `authorInfo.legacyId` of the amendment vs the refinement

**Confirmed rule (from live data):**
- Error = amendment authored by the **reviewer** only
- Cross-collector corrections = NOT errors (e.g. Mohamed correcting Alaa's players)
- Self-corrections = NOT errors (collector correcting their own work)
- System amendments = NOT errors:
  - `type === 'base'` + `payload.pairKey` exists + no author → pressure-pair link
  - `type === 'location'` + `desired.x === null` + no author → system flag

**Score impact confirmed by console:**
- Current MARK score: **77%** (313 error keys — includes Mohamed's specialist work as errors)
- Correct score: **92%** (110 unique error keys — reviewer Omar only)
- Difference: **15 percentage points** — the specialist collector was being misidentified as a reviewer

---

### Part 2 — Freeze Frame Testing

**Question:** Do freeze-frame amendments by the reviewer count as errors?

**Result from console:**
```
FF Errors (by reviewer): 0
FF Cross-collector (ignored): 12
FF Self-corrections (ignored): 6
```

Zero freeze-frame errors in this half. Omar (reviewer) made no FF amendments.
All 18 FF amendments were either A-088 → A-2454 (cross-collector) or self-corrections.

**Confirmed rule:** FF amendment by reviewer = error. Cross-collector FF = NOT error.

---

### Part 3 — Full Amendment Classification

**Console test: all amendment types classified by rule**

```
Type               | ERRORS(reviewer) | Cross-collector | Self-correction
base               | 21               | 0               | 238
deletion           | 37               | 9               | 72
extras             | 17               | 0               | 20
freeze-frame       | 33               | 41              | 10
goal-location      | 13               | 0               | 0
impact             | 5                | 0               | 0
location           | 25               | 5               | 179
players            | 26               | 10              | 293
squad              | 1                | 0               | 0
```

Key insight: **self-corrections (812 total) are massive** and were previously all counted as errors.
This is the biggest source of MARK's inflated error count.

**Confirmed: score uses unique event KEYS, not total amendment actions.**
- 138 total reviewer amendment actions on 110 unique event keys → 92% score.
- Counting actions instead of keys would double-count events with multiple amendments.

---

### Part 4 — Multiple Reviewers Per Half

**Decision confirmed by Ahmed:** A single match/half can have multiple reviewers.
If two people both review with zero collection work, both are reviewers.
Role detection must find ALL pure-amendment authors, not just one.

**Implementation:** `reviewerIds` is a Set, not a single ID.
Reviewer = `diagnostics.work` entry where: `amendment > 0 AND base === 0 AND refinement === 0`

---

### Part 5 — Error Attribution (Who Does the Error Count Against?)

**Question from Ahmed:** If the specialist (2nd collector) did the players refinement and the reviewer corrected it, who does the error count against?

**Decision:** Error counts against whoever did that specific module's work.
In the errors table: Collector column shows the base event author for base errors,
and the refinement author for extras/players/location errors.

In practice from the data: for `wrong-player`, the `Collector` column shows the
specialist's HR code (A-2454 Mohamed), not the base collector.

---

### Part 6 — A/B/C Review Group Investigation

**Question:** Can MARK compute per-review-group (A/B/C) scores matching Tag Once's review tracker?

**Tag Once shows:**
- A-Review: 80 events (Goals, Fouls, Freeze Frame, End Shots, GK Actions Shots, etc.)
- B-Review: 160 events (Clearances, Pass Recoveries, Blocks, Tackles, etc.)
- C-Review: 184 events (Ball Recovery, Aerial Losts, Pressures)
- Total reviewed: 424 of 1,384 base events (960 NOT reviewed at all)

**Investigation:**
1. Tried to map Tag Once subcategories to Apollo cache event names by count-matching → failed
2. Searched Apollo cache for review group config → not stored there
3. Searched Tag Once's JS bundle → not accessible
4. Conclusion: **Tag Once's A/B/C categories are NOT based on event type names alone** — they're based on internal filtering rules (e.g. "Pressures Before Shots" = only pressures within N seconds of a shot)

**Decision:** Defer A/B/C module scores. MARK cannot reliably reproduce Tag Once's exact groupings without access to StatsBomb's internal filtering logic. Keep existing Base/Pressure/Extras/Players/Location/FreezeFrame module breakdown instead.

---

### Part 7 — Bridge Investigation

**Problem discovered:** `lineupPlayers` and `refinements` were not in the bridge payload.
This meant MARK had to read from Apollo cache (which may be empty or have a different match).

**Root cause of all Before fields being empty:**
- Bridge sends `baseEvents` and `amendments` but NOT refinements
- MARK reads extras/location/players/goal-location Before values from Apollo cache
- Apollo cache only has the currently-open match — if Tag Once has a different match open, cache is empty

**Fix:** Bridge now collects all refinements for reviewed event keys from its Apollo cache
(which always has the right match open at audit time) and sends as `refinements: { key_type: payload }`.

**Other bridge discovery:** `authorInfo` is a flat JSON scalar (not a GraphQL object) containing
`{ legacyId, hrcode, firstName, lastName, email }`. Bridge harvests this via passive tap
on all EventHistory queries and auto-sweep.

---

### Part 8 — ASAR_MARKER and BRIDGE_VERSION Root Cause

**Critical bug found and fixed:**

Both `ASAR_MARKER` in `main.rs` and `BRIDGE_VERSION` in `bridge_script.js` were stuck at `'7.5.4'`
and never updated across versions 7.5.5 through 7.5.24.

**Consequences:**
1. `ASAR_MARKER`: `inject_bridge_script` checks `if html_str.contains(ASAR_MARKER)` → returns "already patched".
   Since the marker never changed, every "Embed Bridge" click after v7.5.4 did nothing.
2. `BRIDGE_VERSION`: Bridge guard at startup: `if(window.__MARK_BRIDGE_VERSION__ === BRIDGE_VERSION) return`.
   Since the version never changed, the bridge thought it was already running and exited.

**Result:** Users were running bridge v7.5.4 code regardless of which MARK version they installed.
All bridge improvements from v7.5.5 through v7.5.24 were silently never delivered.

**Fix:** Both must be updated to match the app version on every version bump.
Rule going forward: BRIDGE_VERSION and ASAR_MARKER always match the app version.

---

### Part 9 — AmendmentsTable Full Rewrite

**Old design:** 10 columns (TIME, EVENT, TEAM, EVENT ASPECT, EDIT TYPE, BEFORE, AFTER, COLLECTOR, REVIEWER, CAPTURED)
- Before/After were plain strings
- Event Aspect and Edit Type were separate (Base/Extra/Location/Players + Added/Deleted/Wrong)
- Player pills showed HR codes as text
- No structured type-specific rendering

**New design:** 8 columns (TIME, EVENT·TEAM, ERROR TYPE, MODULE, BEFORE, AFTER, COLLECTOR, REVIEWER)

**12 error types with structured before/after:**

| Error Type | Before | After |
|---|---|---|
| deletion | event name + timestamp | "Removed from session" |
| rename | old event name (strikethrough) | new event name |
| replacement | old event + extras + location | new event + extras + location |
| wrong-extras | changed fields with old values | changed fields with new values |
| wrong-location | x:A y:B | x:C y:D |
| wrong-player | role + player pill (strikethrough) | role + player pill (corrected) |
| wrong-timestamp | MM:SS.mmm (strikethrough) | MM:SS.mmm |
| freeze-frame | Keeper: name / Shooter: name | Keeper: name / Shooter: name |
| goal-location | x:A y:B | x:C y:D |
| squad | old formation | new formation |
| added | "Missing this field" | event name |
| wrong-event | old event name | new event name |

**Player pills:** Jersey # + Name + Team name, colored by status (wrong=red, corrected=green, unchanged=grey)

**Role detection:** Uses `diagnostics.work` from bridge. Three roles:
- `base > 3` → BASE COLLECTOR
- `refinement > 3 AND base === 0` → SPECIALIST
- `amendment > 0 AND base === 0 AND refinement === 0` → REVIEWER
- Two fallbacks if `diagnostics.work` unavailable

**Timestamp format throughout:** `MM:SS.mmm` (e.g. `04:31.450`) — milliseconds always shown

---

### Part 10 — Export Fixes

**5 export issues found and fixed:**

**Issue 1 — Open in Drive button not working**
- `<a href={url} target="_blank">` is a no-op inside Tauri WebView (no browser context)
- Fix: `invoke('open_file', { path: url })` which calls `rundll32 url.dll,FileProtocolHandler`
- This correctly opens any URL in the user's default browser from a Tauri app

**Issue 2 — Drive link pointed to CSV file, not folder**
- Previous: `driveLink = csvLink` (the uploaded CSV's webViewLink)
- Fix: `folderUrl = 'https://drive.google.com/drive/folders/' + subFolderId`
- Now clicking "Open in Drive" opens the whole session folder

**Issue 3 — Half label showing "2H" instead of "2nd Half"**
- `fmtHalf()` had mappings for `'1'`, `'2'`, `'first_half'` etc. but NOT for `'1H'` / `'2H'`
- `session.half` is stored as `'1H'` / `'2H'` in MARK's session system
- Fix: added `'1h': '1st Half', '2h': '2nd Half'` to the map (lowercased before lookup)
- Same fix applies to folder name, sheet name, CSV content

**Issue 4 — Sheet visual identity (PENDING)**
- CSV uploaded as plain text → white Google Sheets appearance
- Fix attempt 1: `drive_upload_file` with `mimeType: application/vnd.google-apps.spreadsheet` → converts on upload
- Fix attempt 2: New `upload_csv_as_sheet` Rust command: upload with conversion + Sheets API batchUpdate
- batchUpdate applies: orange header row, dark summary rows (#1A1A1A), orange column headers, dark data rows (#141414), auto-resize
- **Status: STILL FAILING SILENTLY** — batchUpdate sends 200 but no formatting applied
- Likely cause: service account (`mark-reporter@mark-app-498618.iam.gserviceaccount.com`) may lack
  the `https://www.googleapis.com/auth/spreadsheets` scope in its token, or Shared Drive
  formatting restrictions. Needs investigation next session.

**Issue 5 — Clip timestamp format**
- Old: `r.timestamp.replace(':', 'm') + 's'` → `03m13s` (bad)
- Fix: `r.timestamp.replace(':', '-')` → `03-13.350` (colon→dash, milliseconds preserved)
- Also fixed: local `fmt(sec)` in `handleExportAndUpload` was `MM:SS` only → now `MM:SS.mmm`

---

### Part 11 — Bugs Found and Fixed

**`before is not defined` crash (black screen):**
- `renderBefore(r)` destructured only `{ errorType, before }` from `r`
- But inside, `before.players && renderPlayerDiff(diffPlayers(before.players, after?.players || {}))` referenced `after`
- Same in `renderAfter`: `before?.players` referenced but `before` not destructured
- Fix: both functions now destructure `{ errorType, before, after }` from `r`

**`eventTypeScores is not defined` in saveToFirebase:**
- `eventTypeScores` defined in `handleGetResults` scope
- `saveToFirebase(data, q, abc)` is a separate function that doesn't have access to it
- Fix: `data.eventTypeScores = eventTypeScores` before calling saveToFirebase, then `data.eventTypeScores` inside it

**Firestore nested arrays error:**
- Amendment payloads for freeze-frame contain nested arrays (camera matrices, player position arrays)
- Firestore: "Nested arrays are not supported"
- Fix: `sanitizeForFirestore()` — if payload JSON contains `[[`, wrap as `{ _json: stringified }`

**teamName showing as "Team 2270" (ID instead of name):**
- `teamMap` keys stored as numbers, but `base.teamId` looked up as string (or vice versa)
- Fix: store both `teamMap[p.teamId]` and `teamMap[String(p.teamId)]` on every write
- Also: `teamMap` now merged from three sources: `results.lineupPlayers`, `results.lineupPlayerMap`, `results.teamMap`, and Apollo cache

**Player IDs showing instead of names (id:1045638):**
- `results.lineupPlayers` empty when results restored from a previous session
- Fix: three-layer fallback — `lineupPlayers` array → `lineupPlayerMap` dict → live Apollo cache read
- Apollo cache always read regardless (not only when other sources empty)

**refinementMap empty (Before fields empty for extras/location/goal-location):**
- Root cause: Bridge never sent refinements. MARK read from Apollo cache which may be empty.
- Fix: Bridge now sends `refinements: { key_type: payload }` for all reviewed event keys
- In `handleGetResults`: `data.refinementData = data.refinements || {}`
- In `AmendmentsTable`: refinementMap seeded from `results.refinementData` first, then overlay from live Apollo cache

---

### Build History This Session

| Version | What changed | Status |
|---|---|---|
| v7.5.20 | Full errors table rewrite: reviewer-only rule, 8 columns, all error types, player pills | ✅ |
| v7.5.21 | Player resolution: Apollo cache fallback when lineupPlayers empty | ✅ |
| v7.5.22 | Before empty fix (refinementData); timestamp MM:SS.mmm; teamMap fix; replacement full diff | ✅ |
| v7.5.23 | Root cause fix: bridge now sends refinements directly; teamMap string/number key fix | ✅ |
| v7.5.24 | eventTypeScores not defined in saveToFirebase | ✅ |
| v7.5.25 | ASAR_MARKER + BRIDGE_VERSION both stuck at v7.5.4; Firestore nested arrays fix | ✅ |
| v7.5.26 | before/after not defined in renderBefore/renderAfter (black screen crash) | ✅ |
| v7.5.27 | Open in Drive fix; folder URL; half format; clip timestamp MM-SS.mmm; sheet identity attempt | ✅ |
| v7.5.28 | Sheet tab_id fix; clip timestamp milliseconds in fmt(); sheet formatting improved | ✅ |

---

### Pending Issues (Next Session)

1. **Sheet visual identity** — Sheets API batchUpdate silently not applying.
   - Check: does the service account token include `https://www.googleapis.com/auth/spreadsheets` scope?
   - Check: is the Shared Drive (`1TeuEJqnKiGrCmZZfpfOKFMzwa3KBxO0A`) restricting Sheets API formatting?
   - Check: log the actual HTTP response from batchUpdate (currently only logs on error)
   - Alternative: upload as XLSX with styling applied via the XLSX library (xlsxjs) before upload

2. **A/B/C review group scores** — deferred until StatsBomb's internal event grouping logic is accessible

3. **lineupPlayers persistence** — not saved to Firebase, so restored sessions still need Tag Once open with same match for player names. Consider saving to Firestore on audit save.

