# MARK — Changelog

All notable changes to the MARK desktop app. Versions follow the four-file bump
convention (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
[auto-synced by `scripts/sync-version.js`], and `src/hooks/useUpdateCheck.js`).
The GitHub Actions workflow reads `package.json` for the release tag and the
in-app auto-updater compares the latest GitHub release against
`useUpdateCheck.CURRENT_VERSION`.

> **Golden rule of versioning:** the new release must be *strictly greater* than
> the `CURRENT_VERSION` baked into every installed build, or the updater will
> not prompt. See the v7.3.1 entry for why this bit us.
>
> **Version-number sequence (required):** the patch digit runs **0→9 only**, then
> rolls over to the next minor with the patch reset to 0. So the order is
> `…7.3.8 → 7.3.9 → 7.4.0 → 7.4.1 → …` — there is **no** 7.3.10 / 7.3.11. (The
> 7.3.10 / 7.3.11 builds during the Google-Sheets work are a one-off exception
> that predates this rule; the next clean bump rolls to **7.4.0**.)

---

## [7.5.7] — 2026-06-24

### Changed
- **Audit amendments table: split the `CHANGE` column into two.** Reviewers asked
  for the change to be categorised on two axes instead of one mixed tag:
  - **EVENT ASPECT** (what part of the event was touched): `Base` / `Extra` /
    `Location` / `Players`. Can show **multiple** aspects per event.
  - **EDIT TYPE** (the nature of the collector's mistake): `Added` (a missing
    event the reviewer had to add) / `Deleted` (an extra event the reviewer
    removed) / `Wrong` (a correction). **One** value per event; Added/Deleted
    take priority over Wrong.
  - Mapping from raw amendment `type`: `base`+`camera` → aspect **Base**;
    `extras` → **Extra**; `location` → **Location**; `players` → **Players**;
    `deletion` → **Base** + edit **Deleted**; `added` → **Base** + edit **Added**;
    everything else defaults to **Base** / **Wrong** (safe fallback).
  - Filter pills now span **both** new columns (filter by an aspect *or* by an
    edit type); CSV export gained the two separate columns. Display only — no
    scoring change. Bridge untouched (still 7.5.4).

## [7.5.6] — 2026-06-24

### Added
- **Audit page now has the same video keyboard shortcuts as Scout** (it had none
  before): **↑** play/pause · **→ / ←** seek 400 ms (40 ms with **Shift**) ·
  **+ / −** speed (0.25×–2.00× in 0.25 steps, shown as an `N×` badge). The
  Scout-only *tagging* keys are deliberately NOT included. SessionHistory already
  had these shortcuts (verified, unchanged). Audit drives only its own player
  (it is not a sync-driving mode). Bridge untouched.

## [7.5.5] — 2026-06-24

Four Audit issues reported after 7.5.4 testing — all MARK-side React, no bridge
change (still 7.5.4).

### Fixed
- **#1 — Bridge "disconnected" after moving between modes/halves/matches (the
  real fix this time; 7.5.2's attempt did not work).** Root cause was on the
  **MARK side**, not the bridge: `useSync.getWs()` returned early when the
  singleton socket was already open **without re-wiring the freshly-mounted
  page's `onStatusChange`** — so a new AuditPage stayed stuck on `disconnected`
  even though the bridge was connected. That is why a full MARK logout + Ctrl-R
  was the only thing that "fixed" it. Now `getWs` re-reports the *real* socket
  state on every mount, and a 2 s health-check recreates the socket if closed and
  keeps the status truthful (Audit sends no sync signals, so it never
  self-reconnected before).
- **#4 — The same match/half could not be opened in both Scout and Audit.** Locks
  (`mark_locks`) and the completed-session check ignored mode. Now mode-aware:
  `lockId = matchId_half_mode`, the completed check filters by mode, and sessions
  store a `mode` field. Scout and Audit are independent for the same match/half.
- **#3 — Audit results vanished after Full Report → Back.** The keyed
  `PageTransition` remounts AuditPage, resetting its local `results`. `App` now
  passes `initialResults`/`initialScore`; AuditPage seeds state from them when
  they match the session, and `abcScores` is attached to the results object so
  the A/B/C cards restore too.
- **#2 — Audit sessions did not appear in Session History (+ replay).** History
  only queried `mark_sessions`; Audit sessions live in `mark_audit_sessions`.
  History now loads both (own + admin), maps audit docs to the row shape, tags
  `type:'audit'`. Opening an audit session loads `mark_audit_amendments` mapped
  into the tag shape so click-to-seek works. AuditPage now also saves each
  amendment's `videoTimestamp` so replay can seek (NOTE: only audits saved on
  7.5.5+ have this; older ones seek to 0:00).

## [7.5.4] — 2026-06-24

### Added
- **Per-module quality scores** (Base, Pressure, Players, Location, Extras,
  Freeze Frame) computed in the bridge and shown as cards between the summary and
  the amendments table. **Purely additive** — the existing overall audit score is
  byte-for-byte unchanged. See `MODULE_SCORES.md` for the full validated method
  and the open denominator question. Bridge 7.5.2 → 7.5.4 (asar marker bumped).

## [7.5.3] — 2026-06-24

### Added / Fixed (Audit UI)
- **Replace Video** button (↻) once a video is loaded, to swap the wrong file.
- **Click-to-seek rows** — every amendments row seeks the video to its TIME
  (matches SessionHistory's seconds-based seek).
- **CHANGE filter pills** above the table (later superseded by 7.5.7's split).
- **2/3 video layout** — video occupies 66vh when results show; table scrolls in
  the bottom third. Bridge untouched.

## [7.5.2] — 2026-06-24

### Fixed (did NOT fully resolve — see 7.5.5 #1)
- Attempted to fix the bridge disconnect by decoupling the bridge's localhost
  WebSocket from video attachment (connect on auth-ready + self-heal). This was a
  real improvement to the **bridge** side, but the actual breakage was the
  **MARK-side** stale status callback (fixed in 7.5.5). Bridge 7.5.1 → 7.5.2.

## [7.5.1] — 2026-06-24

### Added / Fixed
- **Collector/reviewer HR-code + name identity resolution.** The bridge harvests
  identity from the collection app's Apollo `EventHistory` query (`authorInfo`
  blob, field `hrcode` — lowercase) and auto-sweeps all authors of a match,
  merging with the persistent Firestore roster (seeded from
  `users_finalized_*.csv`). Numeric author IDs now render as `Name (A-####)`.
- **Corrected collector/reviewer detection rules** (see `DECISIONS.md`):
  collectors can be multiple (views==0 AND base+refinement > 600); reviewers are
  telemetry/event-activation authors minus collectors who made ≥1 change
  (playthrough filter). Bridge 7.5.0 → 7.5.1.

---

## [7.3.6] — 2026-06-16

### Fixed
- **"Change Video" button was on the wrong screen.** v7.3.4 added it to the
  *live review* screen (`ReviewPage`), but the player users actually work with
  is the **session report** (`SessionHistoryPage`). There, once a video was
  loaded, the only control was Show/Hide — no way to swap it. A **Change Video**
  button now sits in the report header (visible once a video is loaded) and
  reopens the picker to replace the current video. Cancelling the picker keeps
  the current video.
- **Download button did nothing.** `exportSessionToXlsx` wrote silently to the
  OS Downloads folder through the *scoped* JS `@tauri-apps/plugin-fs` write,
  with a browser `<a download>` fallback that is a no-op inside a desktop Tauri
  webview. Result: a click looked like nothing happened (no feedback on success,
  silent failure on error).
  - **Fix:** new Rust command `save_xlsx_file(name, data: Vec<u8>)` using the
    native `rfd` save dialog + `std::fs::write` (full fs access, no scope
    limits). The reviewer now sees a real Save dialog and chooses the location.
    The fragile `downloadDir`/`writeFile` + browser fallback path was removed.

---

## [7.3.5] — 2026-06-16

### Added — conditional extra mappings (MARK layer over the sheet taxonomy)
A `MARK_EXTRA_ADDITIONS` map in `TagPanel.jsx` layers **single-pick** extras on
top of the auto-generated `tagging_scenarios.js` taxonomy. Single-pick = the
reviewer selects the extra and goes straight to the team step (no "correct it
to" sub-step, unlike sheet wrong-extras).

| Event · Step | Added options |
|---|---|
| Pass · Missing extra | Step in, Aerial won |
| Pass · Wrong extra | Step in, Wrong Side, Corner, Aerial won |
| Tackle · Wrong extra | generic "Wrong extra" flag (Tackle had no wrong-extra data before; this makes the error type appear) |

The `error_type` step visibility, the "which extra was wrong" / "which extra is
missing" steps, and the keyboard paths all use the combined sheet+MARK lists.
Sheet wrong-extras (e.g. Pass's Left↔Right "Wrong side") keep their two-step
"pick → correct to" flow; only the MARK additions are single-pick. Pass's
pre-existing Left↔Right Wrong Side is untouched and the plain "Wrong Side"
option sits alongside it.

---

## [7.3.4] — 2026-06-15

### Added
- **Change Video button** (originally on `ReviewPage`'s header — relocated to the
  report view in 7.3.6).
- **Camera Off / Camera On** added to the events sidebar as mouse-click events
  (already present in the `TORNADO_EVENTS` taxonomy, just not surfaced).

---

## [7.3.3] — 2026-06-15

### Added
- **Session search.** A search box in the Session History header filters the
  list by **match name OR match ID** (every half of a match shares the match ID,
  so searching an ID surfaces the match and all its halves). Includes a clear
  (×) button and a "no sessions match" empty state.

### Changed — keyboard shortcut reshuffle
Applied to both the keyboard handler (`shortcuts.js`) and the on-screen key
labels (`EventsSidebar.jsx`) so hints stay correct. No duplicate keys.

| Event | Old | New |
|---|---|---|
| Leg Stretch Duel | M | U |
| Tackle | K | A |
| Pass Recovery | N | P |
| Goal Keeper | G | K |
| Pressure | P | G |
| Pass (First time) | U | Q |
| Separation Duel | L | J |

### Removed
- **Missing Event** (the standalone Q-key feature) removed entirely so Q could
  go to Pass (First time). Dropped `MISSING_EVENT_KEY`, the sidebar Missing
  Event card, and the `ReviewPage` Q-key handler. Historical tags still render
  via the stored `tag.isMissing` flag (no longer derived from the reused Q key).
  Deleted the dead, unimported `ErrorTagModal.jsx` (last `MISSING_EVENT_KEY`
  reference). The separate "Missing event" *error type* inside the per-event tag
  flow is unaffected.

---

## [7.3.2] — 2026-06-14

### Added — session report video player
- Keyboard controls on the report video, matching MARK Scout exactly:
  **↑** play/pause · **→/←** seek 400 ms (40 ms with Shift) · **+/−** playback
  speed (0.25×–2×, 0.25 steps). No collection-app sync here — the report is
  standalone. A speed badge in the control bar shows the current rate.
- Enlarged the report video: `maxHeight` 280 px → `60vh`.

---

## [7.3.1] — 2026-06-14

### Added — Goalkeeper wrong-event flow rebuilt
- `GK_WRONG_EVENT_MAP` restructured from arrays to
  `{ correctEvents, extras }` per subtype.
- New 5th GK subtype: **Shot** (key `5`).
- New `gk_extra` step: after picking the correct GK event, the reviewer tags the
  expected extra as a follow-up. Subtypes with no correct events (Save) skip
  straight to extras; subtypes with no extras (Punch) skip to team. Both the
  keyboard and click paths route through the `gkEntry()` helper.

| GK subtype | Correct events | Extras |
|---|---|---|
| Collected | GK (Keeper sweeper), GK (Save) | Second effort, Success, Fail |
| Save | — | Won, Success, Second effort |
| Shot *(new)* | Save attempt, Conceded no save, Post, Wayward, Out endline | Won, Success, Fail, Second effort |
| Punch | GK (Keeper sweeper), Ball recovery, GK (Collected) | — |
| Keeper sweeper | GK (Punch), GK (Save), GK (Collected) | Clear, Claim |

### Fixed — auto-updater was permanently stuck
- `useUpdateCheck.CURRENT_VERSION` had drifted to `7.3.0` while `package.json`
  and the latest published release were `7.2.1`. Because `7.2.1 < 7.3.0`, the
  updater concluded every installed app was already newer than what was
  published and **never offered an update** — so users were frozen on old
  builds (including ones predating the v5.2.0 sidebar events).
- **Fix:** realigned all version files and shipped a release strictly higher
  than any value baked into a shipped build, restoring update prompts for
  everyone. (This is why the rule at the top of this file exists.)

---

## Build infrastructure — the brotli saga (resolved 2026-06-14)

For several days every Windows CI build failed compiling `brotli 8.0.3` with
36× `E0277` errors caused by two incompatible `alloc-no-stdlib` versions
(2.0.4 + 3.0.0) coexisting. `brotli 8.0.3` is the only `^8` release on crates.io
and is upstream-broken; it was pulled in transitively by the Tauri 2.5+ stack
(`tauri-utils` → `brotli ^8`, and `tauri-runtime-wry` → `zmij` → `brotli ^8`).

**Resolution (Claude Code, commits `2400adb`→`7d385fd`):** pinned
`brotli-decompressor=5.0.1`, `alloc-no-stdlib=2.0.4`, `alloc-stdlib=0.2.2`, and
realigned the entire Tauri 2.x stack so only `brotli ^7` is resolved. Builds
have been green since `7d385fd`.

**Lesson:** because the build was down for days, *committed code never shipped*.
The v5.2.0 sidebar events sat in the repo unbuilt, which combined with the
stuck-updater bug to make users believe features were "missing" when they were
really just never delivered. Build health and version hygiene are release-
blocking, not nice-to-haves.

---

## Conventions

- **Versioning:** bump `package.json`, `Cargo.toml`, `useUpdateCheck.js`;
  `tauri.conf.json` auto-syncs in CI via `scripts/sync-version.js`.
- **Version-number sequence:** patch digit `0→9` only, then roll to the next
  minor and reset patch to `0` (`7.3.9 → 7.4.0`). Never go to a two-digit patch
  like `7.3.10`.
- **On-screen version (must always match the release):** the version shows in
  TWO places and both are driven by the version bump — never let them drift:
    1. **OS window title bar** ("MARK X.Y.Z — Review App") — rewritten from
       `package.json` by `scripts/sync-version.js` during the CI build.
    2. **In-app top-left logo** ("MARK vX.Y.Z" on the main page) — rendered from
       `CURRENT_VERSION` in `src/hooks/useUpdateCheck.js`
       (`src/pages/SessionSetupPage.jsx`).
  Bumping the standard version files updates both; verify they read the new
  number before shipping.
- **Every edit:** run a JS/JSX parse check and a brace/duplicate-function guard
  before committing.
- **Custom native ops use `rfd` in Rust** (`pick_video_file`, `save_xlsx_file`)
  rather than the scoped JS fs/dialog plugins — full access, visible dialogs, no
  capability surprises.

---

## [7.5.28] — 2026-07-11

### Fixed
- **Sheet formatting tab_id:** `upload_csv_as_sheet` now fetches the actual Google Sheet tab ID
  via `spreadsheets.get` before calling `batchUpdate` — the tab ID after CSV→Sheet conversion
  is not guaranteed to be `0`.
- **Clip timestamp milliseconds:** Local `fmt(sec)` in `handleExportAndUpload` now produces
  `MM:SS.mmm` (was `MM:SS`). Clip filenames now correctly show e.g. `ball-recovery_12-37.450_Wrong event.mp4`.

### Changed
- Bridge version bumped to `7.5.28`; ASAR marker updated to `v7.5.28`.

---

## [7.5.27] — 2026-07-11

### Fixed
- **"Open in Drive" button now works in Tauri.** `<a href target="_blank">` is a no-op inside
  a Tauri WebView. Replaced with `invoke('open_file', { path: url })` which calls
  `rundll32 url.dll,FileProtocolHandler` — the correct way to open URLs from a Windows desktop app.
- **Drive link points to folder, not file.** Previously `driveLink` was set from the uploaded CSV
  file's `webViewLink`. Now set to `https://drive.google.com/drive/folders/{subFolderId}` so
  "Open in Drive" opens the entire session folder.
- **Half label "2H" → "2nd Half" in folder/sheet/CSV names.** `fmtHalf()` had no mapping for
  `'1H'`/`'2H'` (MARK's internal storage format). Added: `'1h': '1st Half'`, `'2h': '2nd Half'`,
  `'et1': 'ET 1'`, `'et2': 'ET 2'` (lowercased lookup).
- **Clip filenames now use MM-SS.mmm format** (e.g. `03-13.350`) instead of `03m13s`.
  Milliseconds are preserved; colon replaced with dash for filesystem safety.

### Added
- **`upload_csv_as_sheet` Rust command.** Replaces plain `drive_upload_file` for the session CSV.
  Uploads with `mimeType: application/vnd.google-apps.spreadsheet` to convert CSV to native Sheet,
  then calls Sheets API `batchUpdate` to apply MARK dark identity:
  orange header row (#E8590C), dark summary rows (#1A1A1A), orange bold column headers,
  dark data rows (#141414), auto-resize. **Note: formatting still not applying — under investigation.**

### Changed
- Bridge version bumped to `7.5.27`; ASAR marker updated to `v7.5.27`.

---

## [7.5.26] — 2026-07-11

### Fixed
- **Black screen crash on audit results.** `renderBefore(r)` destructured only `{ errorType, before }`
  but used `after?.players` inside the replacement branch → `ReferenceError: before is not defined`
  (same in `renderAfter` which referenced `before?.players`). Both renderers now destructure
  `{ errorType, before, after }` from `r`.
- **ASAR_MARKER and BRIDGE_VERSION updated** to `7.5.25` (from `7.5.24`) to force re-embed.

---

## [7.5.25] — 2026-07-11

### Fixed — Critical: ASAR_MARKER and BRIDGE_VERSION stuck at v7.5.4
**Root cause of all bridge-related failures across v7.5.5–v7.5.24:**
- `ASAR_MARKER` in `main.rs` was `"<!-- MARK_BRIDGE_INJECTED v7.5.4 -->"` — never updated.
  `inject_bridge_script` returns "already patched" if the marker is found in `app.html`.
  Since the marker never changed, every "Embed Bridge" click after v7.5.4 was silently skipped.
- `BRIDGE_VERSION` in `bridge_script.js` was `'7.5.4'` — never updated.
  The bridge guard `if(window.__MARK_BRIDGE_VERSION__ === BRIDGE_VERSION) return` caused the
  new bridge to exit immediately, leaving the old code running.
- **Result:** Users ran bridge v7.5.4 code regardless of which MARK version they installed.
  All bridge improvements from v7.5.5 through v7.5.24 were silently never delivered.
- **Fix:** Both now match the app version. **Rule going forward:** BRIDGE_VERSION and ASAR_MARKER
  must be updated on every version bump.

### Fixed
- **Firestore nested arrays error** in `saveToFirebase`. Amendment payloads (especially freeze-frame)
  contain nested arrays (camera matrices, player positions). Firestore rejects these with
  "Nested arrays are not supported". Fix: `sanitizeForFirestore()` detects `[[` in JSON and wraps
  the entire payload as `{ _json: stringifiedPayload }`.
- **`eventTypeScores` not defined** in `saveToFirebase`. The variable was scoped to `handleGetResults`
  but referenced inside the separate `saveToFirebase` function. Fix: stored on `data.eventTypeScores`
  before calling `saveToFirebase`.

---

## [7.5.24] — 2026-07-11

### Fixed
- **`eventTypeScores is not defined` crash** in `saveToFirebase`. Emergency fix for the broken audit
  save path that prevented results from being persisted to Firestore.

---

## [7.5.23] — 2026-07-11

### Fixed — Root cause: bridge never sent refinements
**All Before fields empty (extras, location, goal-location, replacement details):**
The real root cause was that the bridge never included refinement data in the `qaResultsResponse`.
MARK's `AmendmentsTable` was reading Before values from the Apollo cache in the MARK webview,
but that cache only contains whatever match is currently open in Tag Once — it is never guaranteed
to have the audited match's data.

**Fix:** Bridge now collects all refinements for reviewed event keys from its own Apollo cache
(which always has the right match open at audit time) and sends them as:
```js
refinements: { "eventKey_type": payload, ... }
```
`handleGetResults` stores this as `data.refinementData = data.refinements || {}`.
`AmendmentsTable` seeds `refinementMap` from `results.refinementData` first, then overlays
from the live Apollo cache as a supplement.

### Fixed
- **teamName string/number key mismatch.** `base.teamId` from the bridge is a number; `teamMap` keys
  from `lineupPlayers` could be stored as either type. Fix: all teamMap writes now store both
  `teamMap[id]` and `teamMap[String(id)]`.

---

## [7.5.22] — 2026-07-11

### Fixed
- **Before fields empty for wrong-extras, wrong-location, goal-location.** Partial fix attempt:
  store `data.refinementData` from Apollo cache at audit time; seed refinementMap from it.
  *(Later superseded by the root-cause fix in 7.5.23: bridge sends refinements directly.)*
- **Timestamp format now MM:SS.mmm** (milliseconds always shown). `fmtTs(ms)` updated in
  `AmendmentsTable`. Important for wrong-timestamp errors where the mistake is often sub-second.
- **Player resolution:** Apollo cache always read (not only when lineupPlayers empty).
- **Replacement error now shows full diff:** timestamp, extras, location, and players diff
  in both Before and After columns (was showing only event name).

---

## [7.5.21] — 2026-07-11

### Fixed
- **Player IDs showing instead of names** (`id:1045638`). When results are restored from a
  previous session, `results.lineupPlayers` is empty (never saved to Firebase). Fix: three-layer
  fallback: `results.lineupPlayers` → `results.lineupPlayerMap` → live Apollo cache read.

---

## [7.5.20] — 2026-07-11

### Changed — Full AmendmentsTable rewrite (reviewer-only error rule)

**The correct error rule (confirmed by console testing on live data):**
- Error = amendment authored by the **reviewer** only
- Reviewer = person with `amendment > 0 AND base === 0 AND refinement === 0` (from `diagnostics.work`)
- Specialist collector (e.g. players+location person) has `refinement > 0 AND base === 0` → NOT a reviewer
- Cross-collector corrections, self-corrections, system amendments → NOT errors
- Multiple reviewers per half supported (all qualify if they meet the rule)

**Score impact:**
- Old score (test match): 77% — included specialist's cross-collector corrections as errors
- New score (test match): 92% — reviewer-only, 110 unique error event keys / 1384 base events
- Difference: 15 percentage points. All previous audit scores were wrong.

**New 8-column table design:**
`TIME | EVENT · TEAM | ERROR TYPE | MODULE | BEFORE | AFTER | COLLECTOR | REVIEWER`

**12 error types with type-specific structured before/after rendering:**
`deletion`, `rename`, `replacement`, `wrong-event`, `wrong-timestamp`,
`wrong-extras`, `wrong-location`, `wrong-player`, `freeze-frame`, `goal-location`, `squad`, `added`

**Player pills:** `#Jersey Name (Team)` with color coding (red=wrong, green=corrected, grey=unchanged)
Role labels: Main / Secondary / Third with `changed` / `corrected` / `missing` micro-tags

**Role detection:** Uses `diagnostics.work` from bridge (per-author base/refinement/amendment counts).
Two fallbacks if unavailable: base event authorship analysis, then bridge telemetry `reviewerIds`.

**Error attribution:** Collector column shows base event author for Base errors;
refinement author for Players/Location/Extras errors (correctly attributes specialist's work).

**CSV export updated:** 15 columns with structured before/after strings per error type.
`Match ID | Match Name | Half | Timestamp | Event Name | Team | Error Type | Module |
Before | After | Collector HR | Collector Name | Reviewer HR | Reviewer Name | Captured At`

### Added
- Bridge now sends `refinements` map (`key_type → payload`) for all reviewed events.
- Bridge BRIDGE_VERSION and ASAR_MARKER updated (see v7.5.25 for the full story of why this matters).
