# TagPanel — Error Tagging Workflow
**Source of truth:** `App_Shortcuts.xlsx` Sheet1 (events + extras) × Sheet2 (error corrections)  
**Last verified:** 2026-06-11  
**File:** `src/components/TagPanel.jsx`

---

## Overview

TagPanel is a bottom slide-up overlay triggered when a reviewer presses an event key.  
It follows a multi-step keyboard-only flow — no mouse, no typing.

```
Press event key (E, S, A...)
  → Step 1: Select error type (1-6)
  → Step 2: Select correction / extra (keyed list)
  → Step 3 (some paths): Select team (Home 1 / Away 2)
  → Auto-save
```

---

## Step 1 — Error Types

| Key | Error type | Auto-save? |
|-----|-----------|-----------|
| 1 | Wrong event | No → Step 2 (correction list) |
| 2 | Missing event | ✅ Yes |
| 3 | Extra event | ✅ Yes |
| 4 | Missing extra | No → Step 2 (extra list) |
| 5 | Wrong extra | No → Step 2 (pick extra) → Step 3 (correction) |
| 6 | Not needed extra | No → Step 2 (extra list) |

---

## Step 2A — Wrong Event Corrections (per event)

Keys assigned sequentially: 1,2,3...9,Q,W,E...  
Lists shown in 2-column grid when >5 items.

| Event (key) | Wrong event → correct it to |
|-------------|------------------------------|
| **Pass (E)** | Miscontrol, Dribble, Pass recovery, Pass interception, Tackle, Clearance, Shot, Fifty fifty, Interception, Ball recovery, Block |
| **Shot (S)** | Pass, Miscontrol, Clearance, Tackle, Dribble, GK (Smoother) |
| **Reception (W)** | Miscontrol, Tackle, Ball recovery |
| **Miscontrol (T)** | Dribble, Tackle, Pass, Shot, Clearance, Ball recovery, Block, Reception, Interception |
| **Tackle (K)** | Clearance, Block, Dribble, Fifty fifty, Miscontrol, Pass, Pass recovery, Pass interception, Leg stretch duel, Hold up duel, Separation duel |
| **Dribble (D)** | Tackle, Pass, Pass recovery, Pass interception, Miscontrol, Separation duel, Leg stretch duel, Hold up duel |
| **Interception (V)** | Ball recovery, Clearance, Pass recovery, Pass interception, Block, Tackle |
| **Ball recovery (R)** | Interception, Pass recovery, Pass interception, Block, Clearance, Fifty fifty, GK (Keeper sweeper), GK (Collected), Tackle |
| **Block (B)** | Tackle, Clearance, Interception, Miscontrol, Ball recovery, Pass, Pass recovery, Fifty fifty, Pass interception |
| **Clearance (F)** | Pass recovery, GK (Keeper sweeper), GK (Punch), Interception, Block, Fifty fifty, Tackle, Dribble, Shot, Ball recovery |
| **Pass recovery (P)** | Pass interception, Clearance, Ball recovery, Interception, Tackle, GK (Keeper sweeper), Miscontrol, Dribble, Fifty fifty |
| **Pass interception (I)** | Pass recovery, Clearance, Ball recovery, Interception, Tackle, Fifty fifty, Miscontrol, Dribble, GK (Keeper sweeper) |
| **Fifty fifty (0)** | Dribble, Pass recovery, Tackle, Positioning duel, Pass, Pass interception, Ball recovery, Interception |
| **Foul committed (X)** | Card |
| **Hold up duel (H)** | Positioning duel, Interception, Ball recovery, Shield, Leg stretch duel |
| **Positioning duel (Y)** | Shield, Tackle, Fifty fifty, Hold up duel |
| **Separation duel (L)** | Dribble, Miscontrol |
| **Leg stretch duel (M)** | Dribble, Tackle, Hold up duel, Positioning duel |
| **Shield (C)** | Hold up duel, Tackle, Ball recovery |
| **Goal keeper (G)** | First pick GK sub-type → then wrong event list |

### Goal keeper sub-types (Step 1.5 for GK only)

| Key | Sub-type | Wrong event corrections |
|-----|----------|------------------------|
| 1 | Collected | GK (Punch), Ball recovery |
| 2 | Punch | GK (Collected), GK (Save) |
| 3 | Keeper sweeper | Ball recovery, Clearance |
| 4 | Save | GK (Punch) |

---

## Step 2B — Missing Extra / Not Needed Extra (per event)

Select which extra is missing or not needed → auto-save after team selection.

| Event | Missing / not needed extras |
|-------|----------------------------|
| Pass (E) | Through ball, Backheel, Injury clearance, Launch, Miscommunication |
| Shot (S) | Aerial won, Backheel |
| Miscontrol (T) | Aerial won |
| Tackle (K) | Dribble attempted |
| Interception (V) | Miscommunication |
| Ball recovery (R) | Miscommunication |
| Block (B) | Deflection, Save, Miscommunication |
| Clearance (F) | Aerial won, Miscommunication |
| Pass recovery (P) | Through ball, Backheel, Injury clearance, Launch, Miscommunication |
| Pass interception (I) | Through ball, Backheel, Injury clearance, Launch, Miscommunication |
| Foul committed (X) | Advantage, Penalty |
| Goal keeper (G) | Miscommunication |
| Reception, Hold up duel, Positioning duel, Shield, Separation duel, Leg stretch duel, Pressure start | — (no extras) |

---

## Step 2C — Wrong Extra (per event)

First pick which extra was wrong, then pick the correction.

| Event | Wrong extras → corrections |
|-------|--------------------------|
| **Pass (E)** | Inswinging→Outswinging/Straight · Outswinging→Inswinging/Straight · Straight→Inswinging/Outswinging |
| **Shot (S)** | Aerial won→Regular/Step in · Diving header→Normal · Volley→Half volley · Half volley→Volley/Normal · Set→Prone/Moving · Prone→Set/Moving · Moving→Set/Prone · Open play→First time · First time→Open play |
| **Miscontrol (T)** | Regular→Handball/Dangerous play/Offside · Aerial won→Regular/Step in |
| **Tackle (K)** | Won→Success/Second effort · Success→Won/Second effort · Right→Left/Right take on/Left take on/None · Left→Right/Right take on/Left take on/None · Right take on→Right/Left/Left take on/None · Left take on→Right/Left/Right take on/None |
| **Dribble (D)** | Right→Left/Right take on/Left take on/None · Left→Right/Right take on/Left take on/None · Right take on→Right/Left/Left take on/None · Left take on→Right/Left/Right take on/None |
| **Interception (V)** | Step in→Aerial won · Won→Success/Second effort · Success→Won/Second effort |
| **Clearance (F)** | Regular→Handball/Dangerous play/Offside · Aerial won→Regular/Step in |
| **Pass interception (I)** | Step in→Aerial won |
| **Fifty fifty (0)** | Won→Success/Second effort · Success→Won/Second effort |
| **Foul committed (X)** | Regular→Handball/Dangerous play/Offside · Handball→Regular/Offside · Dangerous play→Regular/Handball/Offside · Offside→Regular/Handball/Dangerous play · No card→Yellow card/Second yellow/Red card · Yellow card→No card/Second yellow/Red card · Second yellow→No card/Yellow card/Red card · Red card→No card/Yellow card/Second yellow |
| **Goal keeper (G)** | Both hands→Right hand/Left hand · Diving→Standing · Standing→Diving · Set→Prone/Moving · Prone→Set/Moving · Moving→Set/Prone · Won→Success/Second effort · Success→Won/Second effort · Second effort→Won/Success |
| **Stoppage** | Injury→Review/Other · Review→Injury/Other · Other→Injury/Review |
| Reception, Hold up duel, Positioning duel, Shield, Separation duel, Leg stretch duel | — (no wrong extras) |

---

## UI Behavior

- **Panel position:** Fixed bottom, full width, slides up — identical to original TagPanel
- **Backdrop:** Semi-transparent blur overlay — click to cancel
- **Breadcrumb:** Shows path e.g. `Pass → Wrong event → Miscontrol`
- **Step label:** Colored indicator above each list
- **Key display:** Every option shows its keyboard shortcut key in orange mono
- **2-column grid:** Used when list has >5 items to keep it compact
- **Auto-save types:** Missing event (2) and Extra event (3) save immediately with green "auto" badge
- **ESC:** Cancels at any step
- **GK special flow:** Sub-type picker appears first before error type

---

## TagPanel Data Sources

All data verified against:
- **Sheet1** (App_Shortcuts.xlsx): Events with their extras/sub-fields per event
- **Sheet2** (App_Shortcuts.xlsx): Error correction guide — col E (tagged), col F (error type), col G (correction)

**Sheet2 column structure:**
- Col A = Extra/Event name (reference)
- Col C = Sub-type label (GK only)
- Col D = Sub-type shortcut
- Col E = What was tagged (the wrong thing)
- Col F = Error type (Wrong event / Missing extra / Wrong extra / etc.)
- Col G = Correction (what it should have been)
- Col I = Sub-type of correction (GK sub-type)

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Keep original panel position/style | Don't break muscle memory of reviewers |
| 2-column keyed grid for long lists | Max 6 rows visible vs 11 in single column |
| Keys 1-9 then Q,W,E,R... | Sequential, no gaps, easy to memorize |
| Missing/Extra event → auto-save | No correction needed, fastest path |
| Wrong extra has 2 sub-steps | First pick which extra was wrong, then which value to correct to |
| GK sub-type first | GK has 4 different sub-events with different wrong-event corrections |
| Per-event filtering | Show only extras relevant to that event — not a global 32-item list |
| Team selection last | Same pattern as original panel — confirms intent before save |


---

## v4.1.0 Status (2026-06-11) — Sheet-Driven Taxonomy Available But Not Yet Wired Into TagPanel

The official error-correction taxonomy is now structured data in the repo at `src/data/tagging_scenarios.js`:

- **465 rules** sourced from `Untitled_spreadsheet (1).xlsx` (provided 2026-06-11)
- **23 parent events** with shortcuts (see canonical list below)
- **17 error types** (canonical capitalization from the sheet, not snake_case)
- **Three filter helpers** exported alongside the raw `TAGGING_SCENARIOS` array:
  - `getErrorTypesForEvent(eventName)` — Step 2 list, filtered for the event
  - `getCorrectionsForScenario(eventName, errorType)` — Step 3 list, filtered for (event + error type)
  - `getTypeQualifiersForCorrection(eventName, errorType, correction)` — Step 4 list, only non-empty for corrections that have qualifiers (Goal keeper variants etc.)

**As of v4.1.0, `TagPanel.jsx` still uses its own hardcoded constants** (`ERROR_TYPES`, `WRONG_EVENT_MAP`, `WRONG_EXTRAS`, `MISSING_EXTRAS`, `EXTRAS`, `GK_SUBTYPES`, `GK_EXTRAS`, `GK_WRONG_EXTRAS`, `GK_WRONG_EVENT_MAP`). The new helpers are sitting in the repo waiting to be consumed.

### Why this was deferred

The v4.1.0 work mistakenly rewired `ErrorTagModal.jsx` instead of `TagPanel.jsx` — `ErrorTagModal.jsx` is dead code (never imported by any page). The data file infrastructure landed correctly; the consumer migration is pending.

### v4.2.0 migration plan (queued)

1. Read `TagPanel.jsx`'s current hardcoded maps and tabulate what they produce for each event
2. Diff that against `tagging_scenarios.js` to find anywhere TagPanel's data is stale or inconsistent with the latest sheet
3. Replace the hardcoded `WRONG_EVENT_MAP`, `WRONG_EXTRAS`, etc., with calls to the helpers from `tagging_scenarios.js`
4. Keep TagPanel's existing UI shape exactly the same (the keyed grid layout, the 1–9 → Q,W,E,R… key sequencing, the team selection step, auto-save behavior for Missing/Extra event) — only swap the data layer
5. Delete the dead `src/components/ErrorTagModal.jsx`

### Canonical event list (from the sheet, as of 2026-06-11)

| Event | Shortcut |
|---|---|
| Ball recovery | R |
| Block | B |
| Card | (mouse) |
| Clearance | F |
| Dribble | D |
| Fifty fifty | (sheet says mouse — MARK keeps key 0) |
| Foul committed | X |
| Goal Keeper | G |
| Hold up duel | H |
| Interception | V |
| Leg stretch duel | (sheet says U — MARK keeps M) |
| Miscontrol | T |
| Pass | E |
| Pass (First time) | (sheet says Q — MARK skipped, Q is Missing Event) |
| Pass interception | I |
| Pass recovery | (sheet says P — MARK skipped, P is Pressure) |
| Positioning duel | Y |
| Pressure start | (sheet says G — shares with Goal Keeper, likely an attribute) |
| Reception | W |
| Separation duel | (sheet says J — MARK keeps L) |
| Shield | C |
| Shot | S |
| Tackle | (sheet says A — MARK keeps K) |

### Canonical error-type list (17, in sheet order)

Wrong event · Missing event · Extra event · Wrong outcome · Wrong height · Wrong direction · Wrong body part · Wrong technique · Wrong GK body state · Wrong type · Wrong kind · Wrong side · Wrong extra · Missing extra · Not needed extra · Missing Outcome · Not needed Outcome

Frequency in the sheet (largest first): Wrong event 141 · Wrong body part 66 · Wrong type 60 · Wrong technique 32 · Wrong extra 30 · Missing event 20 · Extra event 20 · Wrong direction 20 · Wrong outcome 18 · Missing extra 16 · Not needed extra 16 · Wrong GK body state 12 · Wrong height 6 · Missing Outcome 2 · Not needed Outcome 2 · Wrong kind 2 · Wrong side 2.

### Removed concepts (not in the official taxonomy)

- "Wrong Player" — was a MARK-only option, not in the sheet. Will be removed from TagPanel during v4.2.0 migration unless explicitly kept by request.
- "Confused With" — duplicated "Wrong event". Will be removed during migration.


---

## v4.2.0 Update (2026-06-11) — Migration Complete

The TagPanel migration planned in the v4.1.0 notes was completed in v4.2.0.

**`src/components/TagPanel.jsx` now consumes `src/data/tagging_scenarios.js`** via three memoized helpers:

```js
import { TAGGING_SCENARIOS } from '../data/tagging_scenarios'

function getWrongEventList(eventId)   // -> [...] for "Wrong event" step
function getMissingExtrasList(eventId) // -> [...] for "Missing extra" + "Not needed extra" steps
function getWrongExtrasMap(eventId)    // -> { tagged: [corrections] } for "Wrong extra" step
```

What was hardcoded before (`MISSING_EXTRAS`, `WRONG_EXTRAS`, `WRONG_EVENT_MAP` constants) is now derived from the master spreadsheet. The 10 attribute-level error types the sheet defines (Wrong extra, Wrong outcome, Wrong direction, Wrong body part, Wrong technique, Wrong height, Wrong type, Wrong kind, Wrong side, Wrong GK body state) are merged into a single map to preserve MARK's existing "Wrong extra" workflow.

**`GK_WRONG_EVENT_MAP` remains hardcoded** inside TagPanel because the sheet doesn't model the 4 GK sub-types (Collected, Punch, Keeper sweeper, Save) the same way MARK does. If this needs to be sheet-driven later, the sheet would need a "Source GK action" dimension.

**Card event** still doesn't have a mouse trigger in the UI — see the v4.3.0 queue in MARK_CONTEXT.md.

**ErrorTagModal.jsx** is confirmed unused; pending deletion.
