# MARK — Per-Module Quality Scores

Status: **shipped in v7.5.4** as an additive feature. The scoring *method* is
validated on ONE match; the exact denominator is **pending confirmation from the
analysis team** (see "Open question" below). The overall audit score is
unchanged by this feature.

---

## What it measures

For each module, a **% clean** score (higher = better) describing the
**collector's** quality in that module, detected through the **reviewer's** edits.
Example: `Location 80%` = the collector's location work was 80% clean (the
reviewer had to fix 20%).

Modules scored: **Base, Pressure, Players, Location, Extras, Freeze Frame.**
Ignored: **impact, squad** (per user decision).

---

## The validated method (user's chosen rules)

> Score per module = `(denominator − errors) ÷ denominator × 100`

**Denominator** = events the reviewer **VIEWED** (telemetry / `event-activation`
records authored by that reviewer) that **have** that module:
- **base** = viewed base events that are NOT pressure-start/end.
- **pressure** = viewed base events whose `payload.name` is `pressure-start` or
  `pressure-end` (pressure is carved OUT of base).
- **players / location / extras / freeze-frame** = viewed events that have a
  refinement record of that type.

**Errors** (numerator subtrahend) = of those viewed events, the ones the reviewer
**CHANGED** in that module:
- amendment of type `players`/`location`/`extras`/`freeze-frame` → that module.
- amendment of type `base` or `deletion` → **base** (or **pressure** if the event
  is a pressure-start/end).
- a reviewer-authored base event (an **added/missed** event) → **base** only
  (or **pressure**), **NOT** the partials. (Earlier we tried "added hits all
  required-partials"; the reference proved that wrong — see below.)

**Rules:**
- Error unit = the **event** (an event with ≥1 fix in a module = 1 error for that
  module; capped at 1 per module per event).
- **No unique events** — one event can be an error in several modules at once.
- **Deletions are KEPT** in the denominator; **added events are COUNTED**.
- Only the **collector** is scored; only the **reviewer's** edits count as errors;
  other people's edits on the same module are ignored. Per half.

Data facts that make this work (StatsBomb "Tag Once" Apollo cache):
- Events have `category` (`base` / `refinement` / `amendment` / `telemetry` /
  `metadata`), `type`, `author`, `key`, `partId`, `matchId`, `payload`.
- Modules are **separate records sharing the event `key`** (a base record + its
  players/location/extras refinement records).
- Pressure is a **base event** with `payload.name = pressure-start|pressure-end`
  (NOT a separate record). `payload['required-partials']` lists expected modules.
- Amendments carry a module `type` (this is the signal that makes per-module
  attribution possible): `base`, `deletion`, `location`, `extras`, `players`,
  `camera`, `added`.

---

## Validated numbers — match 1442703, 1st half

Collector **Karim Ahmed (1006245)**, reviewer **Fady Mamdouh (A-00024)**.
MARK's method (denominator = all viewed events):

| module       | MARK score | errors | denom |
|--------------|-----------:|-------:|------:|
| OVERALL      | 87.47%     | 55     | 439   |
| base         | 90.40%     | 36     | 375   |
| pressure     | 93.75%     | 4      | 64    |
| players      | 100.00%    | 0      | 241   |
| location     | 100.00%    | 0      | 219   |
| extras       | 92.83%     | 17     | 237   |
| freeze-frame | 100.00%    | 0      | 6     |

Cross-check: distinct error events (any module) = **55** = the overall errors. ✓
The 4 pressure errors were two deleted pressure start/end pairs (1:41 and 9:49).

---

## Analysis-team reference (the source of truth to reconcile with)

From the corporate analysis team (`Collector Module Score.csv` in the
video-feedback-dashboard; columns: `hr_code, module,
collector_mod_event_count, collector_score, errors, match_count`), same match/half:

| module   | ref score | errors | denom |
|----------|----------:|-------:|------:|
| base     | 86.57%    | 47     | 350   |
| extras   | 90.79%    | 21     | 228   |
| location | 100.00%   | 0      | 212   |
| players  | 100.00%   | 0      | 234   |
| pressure | 93.55%    | 4      | 62    |
| impact   | —         | 0      | —     |
| squad    | 100.00%   | 0      | 2     |

---

## OPEN QUESTION (must resolve before these scores are authoritative)

MARK's denominators run **consistently higher** than the reference (base 375 vs
350, extras 237 vs 228, location 219 vs 212, players 241 vs 234, pressure 64 vs
62). Errors mostly match; it's the **"reviewed events" count** that differs.

We investigated the 25-event base gap at length and could NOT reproduce the
reference's 350 from the cache with any single rule we tried (it is not a simple
event-name exclusion, not "drop added events" (→353), not "drop deletions"
(→327); 350 sits in between). Theories tested and rejected are in the
2026-06-24 module-scores transcript.

**User's final decision:** keep MARK's method as-is (denominator = all viewed
events → base ~375) **until the user talks to the analysis team** to learn their
exact denominator rule. The scores may be **tuned** afterward to match the
reference. Claude was explicit it could NOT certify MARK's method as "more
correct" than the team's — for a score people are judged by, matching the
authoritative source is what matters.

Also: validated on **ONE match only**. Should be re-checked on a 2-collector
match and an ET half before being fully trusted.

---

## Where it lives in code

- **Bridge** (`src-tauri/src/bridge_script.js`, `getQAResults` handler): computes
  `moduleScores` and includes it in the `qaResultsResponse`. Additive — does not
  touch the existing overall scoring.
- **UI** (`src/pages/AuditPage.jsx`): `ModuleScores` component renders the cards
  from `results.moduleScores` (which flows through `setResults(data)`).
