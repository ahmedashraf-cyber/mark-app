# MARK — Full Context
**Version:** 4.2.0  
**Last updated:** 2026-06-11 (v4.2.0)  
**Status:** Active, in use by Hudl Egypt reviewers

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
# working file: /home/claude/mark_push/src/...
# push dir: /home/claude/mark_push/
```

**Version bump rule:** Always bump in `package.json` ONLY — `scripts/sync-version.js` auto-patches `tauri.conf.json` (version + window title) during `npm run build`.

**Push rule:** After every push, wait for GitHub Actions green, then install the new `.msi` from the `v{VERSION}` release.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri 2 (Rust + WebView2, Windows only) |
| UI | React 19 + Tailwind CSS 3 |
| Design | Dark theme, `#E8590C` orange, Inter + DM Sans + JetBrains Mono |
| Auth | Firebase Auth — same trainer accounts as FIELD |
| Database | Firebase Firestore — same project as FIELD |
| Video sync | Bridge script injected into collection app via DevTools → Firestore |
| Match data | Google Sheets API (live fetch on load) |
| Build CI | GitHub Actions → Windows runner → Tauri build → GitHub Release |

---

## File Structure

```
mark-app/
├── scripts/
│   └── sync-version.js        # Auto-patches tauri.conf.json title + version from package.json
├── src/
│   ├── firebase/config.js     # Firebase init (same project as FIELD)
│   ├── hooks/
│   │   ├── useAuth.jsx        # Auth — reads trainer profile from Firestore
│   │   ├── useSync.js         # Writes navCommand to Firestore (video sync)
│   │   └── useUpdateCheck.js  # Checks GitHub Releases for newer version; exports CURRENT_VERSION
│   ├── data/
│   │   ├── shortcuts.js       # TORNADO_EVENTS array + KEY_TO_EVENT map + MISSING_EVENT_KEY
│   │   └── matches.js         # Legacy static 127-match fallback (replaced by live Sheets fetch)
│   ├── pages/
│   │   ├── LoginPage.jsx      # Sign in with FIELD credentials
│   │   ├── SessionSetupPage.jsx # Match/half selection + lock + live matches from Sheets API
│   │   ├── ReviewPage.jsx     # Core review UI — video, tagging, timeline, quality score
│   │   └── SessionHistoryPage.jsx # Past sessions list
│   ├── components/
│   │   ├── TagPanel.jsx       # Bottom slide-up overlay — full error tagging workflow
│   │   └── TaggedEventsList.jsx # Timeline + cards of tagged errors
│   ├── utils/
│   │   └── exportSession.js   # Exports session to .xlsx
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css              # FIELD design tokens (CSS vars)
├── src-tauri/
│   ├── src/
│   │   ├── main.rs            # Tauri commands: inject_bridge_script, open_file, etc.
│   │   └── bridge_script.js   # Injected into collection app — Firebase listener + video control
│   ├── Cargo.toml
│   ├── tauri.conf.json        # productName, version, window title (auto-synced)
│   └── build.rs
├── .github/workflows/build.yml # CI: read version → delete old release → Tauri build → GitHub Release
├── package.json               # version is the single source of truth
├── scripts/sync-version.js    # Pre-build: patches tauri.conf.json from package.json
└── MARK_CONTEXT.md
```

---

## Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `mark_sessions` | One doc per review session |
| `mark_error_tags` | One doc per error tagged |
| `mark_locks` | Half-level lock: `{matchId}_{half}` → reviewer |

### mark_sessions schema
```
sessionId, matchId, half, matchName, homeTeam, awayTeam, matchDate,
reviewerId, reviewerEmail, reviewerName,
collectorId, collectorCode,
status: 'in_progress' | 'completed',
isFirstReview: boolean,
totalTaggedErrors, totalReviewedEvents,
qualityScore: 100 - ((errors/events) × 100)  ← higher = better
startedAt, completedAt
navCommand: { action, shift, ts }  ← written by MARK, read by bridge
collectionAppTime: { currentTime: ms, ts }  ← written by bridge every second
```

### mark_error_tags schema
```
sessionId, matchId, half,
reviewerId, reviewerEmail,
triggeredKey, triggeredEventId, triggeredEventLabel,
extras: [errorTypeId, gkSubTypeId?, selectedExtra?, correction?],
team: 'home' | 'away' | null,
videoTimeSec,
timestamp, isMissing
```

---

## Video Sync Architecture

```
Reviewer presses arrow in MARK
  → useSync.js writes navCommand to Firestore mark_sessions/{sid}
  → bridge_script.js (running inside collection app) reads via onSnapshot
  → bridge moves collection app video: video.currentTime += step
  → collectionAppTime written every second for event count calculation
```

**Auto event count formula:**
```
endTs = video.currentTime × 1000   (bridge writes this in ms)
startTs = 0                         (always from match start)
count = events where videoTimestamp between startTs and endTs
exclude: starting-xi, half-start, squad
```

---

## Matches Sheet Live Fetch

`SessionSetupPage.jsx` fetches from Google Sheets API on every load:
1. GET spreadsheet metadata → reads first tab name (auto-discovers, no hardcoding)
2. GET values for that tab A1:Z
3. Maps by header row — column aliases handle any capitalisation/spacing
4. Correct sheet ID: `1zoh7CmoQKPMLGBEklHXznG1Y8xBS-iuu0phRWn8-wXc`
5. Headers: `Production ID, Staging ID, Game Week, Competition, Country, Match Date, Match Name, Home Team, Away Team, Season, Trainer`

**Known bad ID (DO NOT USE):** `1dPwnYhIOiLUy_aBuVijPH3xtU6kxnEu-8FF115kXjSc` — this was from the system prompt and is wrong.

---

## Quality Score Formula

```
Quality Score = 100 - ((Tagged Errors / Total Reviewed Events) × 100)
Higher = better. 100 = perfect.
```

---

## Version Bump Procedure

```bash
# 1. Update ONLY package.json version
# 2. Commit and push — sync-version.js handles tauri.conf.json automatically
# 3. Wait for GitHub Actions green
# 4. Install new .msi from Releases
```

**Never manually edit the version in `tauri.conf.json`** — it gets overwritten by `sync-version.js` on next build.

---

## GitHub Actions Workflow

`.github/workflows/build.yml`:
1. PowerShell reads version from `package.json`
2. Deletes existing GitHub release for that version tag (if any) — prevents asset conflict
3. Runs `npm run build` (which runs `sync-version.js` first)
4. Tauri build → `MARK_{VERSION}_x64-setup.exe` + `.msi`
5. Creates GitHub Release tagged `v{VERSION}`

**Tag format:** `v2.9.8` (not `latest`) — each version gets its own release.

---

## Design System

Identical to FIELD:
- Background: `--bg: #0a0a12`, `--bg-2: #111120`, `--bg-3: #1a1a2e`
- Text: `--t-1`, `--t-2`, `--t-3`
- Borders: `--b-1`, `--b-2`
- Accent: `--p2: #E8590C` (orange)
- Fonts: Inter (headings/800), DM Sans (body), JetBrains Mono (mono/code)
- Team colors: Home `#0A84FF`, Away `#FF453A`

---

## FIELD Integration

| FIELD Gate | What it shows |
|------------|--------------|
| Trainer gate → Review tab | "Open MARK" + own session history |
| BSup gate → Review dashboard | All trainer sessions + real-time scores |
| BM gate | Aggregate scores across all batches |

---

## Pending / Future

- FIELD integration screens (Review tabs in Trainer/BSup/BM gates)
- Attitude tracking (session behavior signals — store silently now, use later)
- TagPanel — verify per-event extras are 100% correct with Wafaa


---

<!-- ============================================================= -->
<!-- SESSION 2026-06-11 — v4.1.0 RELEASE · FADY ARCHIVED · 5.0.0 CANCELLED -->
<!-- ============================================================= -->

## v4.1.0 Release (2026-06-11) — PARTIAL DELIVERY · Read this carefully

### What shipped and IS active in production

1. **Version bumps everywhere** (Cargo.toml was 2.9.8, useUpdateCheck.js was 2.9.10, both were lagging — now all four files are aligned at 4.1.0):
   - `package.json` → 4.1.0
   - `src-tauri/Cargo.toml` → 4.1.0
   - `src-tauri/tauri.conf.json` → 4.1.0
   - `src/hooks/useUpdateCheck.js` `CURRENT_VERSION` → 4.1.0 (this drives the header bar display)
2. **Two new parent events in `src/data/shortcuts.js`:**
   - **Pass Interception** — key `I` (was missing entirely)
   - **Card** — mouse-only event (was missing entirely)
3. **`sheetEvent` field** added to every `TORNADO_EVENTS` entry — maps each MARK event to its canonical name in the official taxonomy sheet, so any consumer can look up filtered error-type/correction lists.
4. **New file: `src/data/tagging_scenarios.js`** (~103 KB) — the full official error-correction taxonomy:
   - 465 scenarios across 23 events × 17 error types (sourced from the updated `Untitled_spreadsheet (1).xlsx` provided 2026-06-11)
   - Three filter helpers exported: `getErrorTypesForEvent(event)`, `getCorrectionsForScenario(event, errorType)`, `getTypeQualifiersForCorrection(event, errorType, correction)`
   - Plus `TAGGING_SCENARIOS` (raw array) and `ALL_ERROR_TYPES` (the 17 in canonical order)

### What was attempted but DOES NOT take effect

`src/components/ErrorTagModal.jsx` was rewritten to consume the new `tagging_scenarios.js`. **However, `ErrorTagModal.jsx` is dead code** — it is not imported by `App.jsx`, `ReviewPage.jsx`, or any other page. The actual error-tagging UI in production is **`src/components/TagPanel.jsx`** (~27 KB), which `ReviewPage.jsx` imports and renders.

`TagPanel.jsx` carries its OWN hardcoded taxonomy (constants: `ERROR_TYPES`, `WRONG_EVENT_MAP`, `WRONG_EXTRAS`, `MISSING_EXTRAS`, `EXTRAS`, `GK_SUBTYPES`, `GK_EXTRAS`, `GK_WRONG_EXTRAS`, `GK_WRONG_EVENT_MAP`, `TEAM_BTNS`, `KEYS`). It has zero references to `tagging_scenarios` or `getCorrectionsForScenario`.

So as of v4.1.0:
- The `tagging_scenarios.js` infrastructure exists in the repo but no production component consumes it
- TagPanel still drives the actual reviewer experience using its older hardcoded data
- Reviewers WILL see the new events Pass Interception (I) and Card in the keyboard handler, since those land in `shortcuts.js` which TagPanel imports — but they may not have full taxonomy support inside the panel itself

### Next step (queued for v4.2.0)

Migrate `TagPanel.jsx` to consume `tagging_scenarios.js` instead of its own hardcoded maps. Compare TagPanel's current maps against the sheet rules first — anywhere they diverge, the sheet is canonical (per 2026-06-11 decision).

### Sheet conflicts deliberately skipped (preserves reviewer muscle memory)

Per the explicit instruction "we will not change the current structure":

| Sheet rule | What MARK keeps |
|---|---|
| Tackle = A | Tackle stays K |
| Separation duel = J | Stays L |
| Leg stretch duel = U | Stays M |
| Fifty fifty = By mouse | Stays key 0 |
| Pass (First time) = Q | Q stays as MISSING_EVENT_KEY — Pass (First time) not added |
| Pass recovery = P | P stays as Pressure — Pass recovery not added |
| Pressure start = G | Shares G with Goal Keeper — looks like an attribute, not added |

### Items removed from the OLD ErrorTagModal (not in taxonomy)

- "Wrong Player" — not in the sheet's 17 error types
- "Confused With" — was effectively a duplicate of "Wrong event"

These were removed from `ErrorTagModal.jsx`, but since that file is dead code the visible effect is nil. When TagPanel gets migrated, the equivalent removals will need to happen there.

---

## Versioning Cadence Rule (NEW, set 2026-06-11)

**`4.1.0 → 4.2.0 → 4.3.0 → ... → 4.9.0 → 5.0.0 → 5.1.0 → ...`**

Every build increments the MIDDLE digit. After 4.9.0, the next is 5.0.0. After 5.9.0 → 6.0.0. Apply this consistently to all four version fields. The build script `scripts/sync-version.js` keeps tauri.conf.json in sync with package.json automatically; Cargo.toml and useUpdateCheck.js currently must be bumped manually (auto-sync gap noted on 2026-06-11 when Cargo.toml was discovered at 2.9.8 while package.json was at 4.0.0 — fixed in this release).

The next 5.0.0 is simply the natural successor to 4.9.0. It is NOT a reservation for a major architecture rewrite.

---

## Roadmap Changes (2026-06-11)

### MARK 5.0.0 architecture migration — CANCELLED

The local-WebSocket-bridge architecture proven in the 2026-06-09 session (see SYNC_PROBLEM_CONTEXT.md) is no longer being pursued. Production sync stays on MARK 4.x indefinitely. The Firebase-quota reduction strategy that was planned for MARK 5.0.0 is therefore also off — quota management for MARK + FIELD goes back to "stay on Firebase, watch usage, optimize FIELD reads if needed, consider Blaze upgrade when quotas force it."

### Fady (PocketBase experiment) — ARCHIVED

The `fady-app` repo (https://github.com/ahmedashraf-cyber/fady-app) was archived on 2026-06-11. Built up to v0.4.3 as a MARK 4.0.0 clone with PocketBase swapped in for Firebase. Key technical finding: PB's HTTP polling at 1500ms coalesces rapid arrow-key presses; only push-based realtime (Firestore's `onSnapshot`, or PB's SSE which we didn't get to) delivers every write. The architectural gap was the reason MARK has remained on Firebase.

Result: no migration off Firebase. See SYNC_PROBLEM_CONTEXT.md for details.

### Going forward, the team owns two repos

- **mark-app** — desktop review app (Tauri 2, React 19), Firebase backend. Current version 4.1.0.
- **flowops** — FIELD web app for training operations (HTML/JS, Firebase backend).

No experiments. No third repos. No architecture migrations.

### Hard scope rules (set 2026-06-11)

- **Don't change the current MARK structure** — when in doubt, add new things rather than replace existing ones.
- **The sheet is the source of truth** for the error-correction taxonomy. When TagPanel and the sheet disagree, follow the sheet. The current version of that sheet is the one provided on 2026-06-11 (`Untitled_spreadsheet (1).xlsx`, 465 rules); store any future updates in `src/data/tagging_scenarios.js` rather than hardcoding into components.
- **Preserve the 3-step (sometimes 4-step) tagging workflow:** event → error type (filtered) → correction (filtered) → optional type qualifier.


---

<!-- ============================================================= -->
<!-- SESSION 2026-06-11 — v4.2.0 RELEASE · TAGPANEL MIGRATION COMPLETE -->
<!-- ============================================================= -->

## v4.2.0 Release (2026-06-11) — TagPanel Now Consumes Sheet Data

### What shipped

This is the follow-up to v4.1.0 that actually completes the user-facing migration. v4.1.0 added the data file but ErrorTagModal (the consumer it touched) turned out to be dead code. v4.2.0 fixes that by migrating **TagPanel.jsx** — the real production component — to consume `tagging_scenarios.js`.

**Changes to `src/components/TagPanel.jsx`:**

- Removed hardcoded `MISSING_EXTRAS`, `WRONG_EXTRAS`, `WRONG_EVENT_MAP` constants (~2.4 KB of stale data)
- Added new import: `import { TAGGING_SCENARIOS } from '../data/tagging_scenarios'`
- Added three computed (memoized) helpers at module load:
  - `getWrongEventList(eventId)` — pulls from sheet's "Wrong event" rules, flattens Goal keeper + Type qualifier into "GK (Type)" so the display matches MARK's existing convention
  - `getMissingExtrasList(eventId)` — combines sheet's "Missing extra" and "Not needed extra" rules (TagPanel uses one list for both UI steps)
  - `getWrongExtrasMap(eventId)` — `{ tagged: [corrections] }` map built across 10 attribute-error sheet types (Wrong extra + Wrong outcome + Wrong direction + Wrong body part + Wrong technique + Wrong height + Wrong type + Wrong kind + Wrong side + Wrong GK body state), which MARK collapses into the single "Wrong extra" workflow step
- `GK_WRONG_EVENT_MAP` stays HARDCODED — the sheet doesn't split Goal Keeper into MARK's 4 sub-types (gk_collected, gk_punch, gk_keeper_sweeper, gk_save) the same way, so we kept MARK's existing data here

**Workflow, keys, breadcrumbs, autosave, team selection — all unchanged.** Only the data source changed.

**Version bumps everywhere:**
- `package.json` 4.1.0 → 4.2.0
- `src-tauri/Cargo.toml` 4.1.0 → 4.2.0
- `src-tauri/tauri.conf.json` 4.1.0 → 4.2.0
- `src/hooks/useUpdateCheck.js` `CURRENT_VERSION` 4.1.0 → 4.2.0

### What the reviewer will see in v4.2.0

- Header bar reads "MARK · Review App · v4.2.0"
- Pass Interception (key `I`) — was already wired into TagPanel's hardcoded data before v4.1.0; still works
- All correction lists across all events now reflect the master spreadsheet (`Untitled_spreadsheet (1).xlsx`, 465 rules). Any divergence between the previous hardcoded data and the sheet is reconciled in favor of the sheet.
- Any future updates to the taxonomy can be done by regenerating `src/data/tagging_scenarios.js` from the sheet — no more touching component code for data changes.

### Still pending (queued for v4.3.0 or later)

- **Card (mouse-only)** event has no UI trigger in MARK currently — `shortcuts.js` lists it as `{ key: null, mouse: true }`, but the review page only handles keyboard events. To make Card usable, a clickable button needs to be added somewhere in the review UI. The taxonomy data for Card is already in `tagging_scenarios.js`.
- **Dead code cleanup** — `src/components/ErrorTagModal.jsx` is now confirmed unused and can be deleted in a follow-up commit.
- **GK_WRONG_EVENT_MAP** — currently hardcoded inside TagPanel. If the team wants this data driven by the sheet too, the sheet's Goal Keeper rules need to encode the GK subtype dimension explicitly (e.g., via a "Source GK action" column), or a side-table can live in `tagging_scenarios.js`.

### Versioning cadence rule (reminder)

`4.2.0 → 4.3.0 → 4.4.0 → ... → 4.9.0 → 5.0.0 → 5.1.0 → ...`
