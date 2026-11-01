# My halves

A **read-only** screen. A collector rewatches their own halves and sees their errors against the model answer. Reviewer roles get the same view for any collector. It reads the Google Sheet and **writes nothing** (a test asserts there is no write request).

| | |
|---|---|
| Entry | Home page card "My halves" (collectors) / "Halves" (reviewers). Hidden entirely, not shown locked, for a role with neither permission. |
| Code | `src/pages/MyHalvesPage.jsx`, `src/components/HalfDetail.jsx`, `EventDetailTable.jsx`, `LocalVideoDrop.jsx`, `SessionsTable.jsx` (shared with Admin), `src/utils/myHalves.js`, `myHalvesSheet.js`, `sheetIndex.js`, `hrCode.js`, `eventAttrs.js`, `sessionScores.js` (shared with Admin) |
| Not changed | Comparison, the comparison engine, scoring, Tag, Self-Review, Insights, Drill, Scout, Audit |

## Who sees what

Two permissions in the Role Access matrix (appended as the last two columns, so every existing column keeps its position). The defaults are in `capabilities()` like every other permission; a Batch Manager can change them in the matrix, and a column missing from the sheet falls back to the defaults.

| Permission | Default on for |
|---|---|
| `viewOwnHalves` | both collector roles, and Batch Manager, Batch Supervisor, Batch Coordinator, Offline Quality Reviewer, Offline Quality Team Leader, Training Supporter |
| `viewAnyHalves` | the six roles above (not collectors) |

An unknown or empty role gets neither (a typo in the roster fails closed).

## Identity

The HR-code is the signed-in person's own: `roleInfo.code`, resolved from the Supervisor tab by email at sign-in (collectors who log in with an HR-code get the same value). **It is never a typed field.** If it cannot be resolved, the screen says so and reads nothing.

Matching is by `hrCode.js`: case, spaces and typographic dashes (en dash, em dash, minus, non-breaking hyphen) are ignored, so `a-1650`, ` A-1650 ` and `A–1650` are one person. `A1650` (no hyphen) and `A-16500` are different people, deliberately: guessing would show one collector another's halves. Free-text search is a partial match by nature (typing `a-1650` also finds `A-16500`); the **HR-code filter** is the exact one.

## What it reads, and how much

Read once when the page opens (and again on Reload):

| Tab | How |
|---|---|
| `field_sessions`, `scores`, `session_edits` | whole tab, once |
| roster (`Supervisor`) | **reviewers only**, columns **A to D** only: the password column is never requested |
| `field_events` | column A only (an index, also used for the event counts) |
| `field_events` rows, `comparison_detail` rows | only the rows of the half being opened, through `sheetIndex.js` |

`field_events` has 39 columns and every event of every session, so reading it whole is not workable (a Google file is capped at 10 million cells). `sheetIndex.js` reads column A, fetches only the rows it needs, then **re-reads column A and requires the id to sit on exactly the same rows**; the fetched rows must also all carry that id and be the number expected. On any mismatch it re-indexes and retries, and after three attempts it reads the whole tab and filters it. So the answer is what a full read would give. This was proven by test: an early version missed rows added for the same half mid-read (found by a randomised test, 5 of 300), the second check fixed it, and 15,000 randomised trials across five seeds, with edits at every read and sessions rewritten mid-read, gave 0 wrong answers.

## The list

One row per session: match ID, teams, half and part, save date, collection method, number of events, collection speed (events per minute), and the latest score (Overall, A, B, C, D, TO, Pressure).

- No row in `scores`: **Not compared**, never 0%.
- A module with no model events, or a run older than the module scores (v7.8.85): **-**, never 0% or 100%.
- A run is **stale** when the session's `match_id` or `half` was edited (per `session_edits`) after the run: flagged "Stale, match changed" and never shown as the current score. It is left out of averages and its numbers are blank in the CSV.
- The same half tagged twice: both sessions are listed, newest first.
- Model answer sessions (`is_model = 1`) are **never listed to a collector**, including one recorded under their own HR-code. Reviewers see them labelled "Model answer".
- Scores are matched to sessions by **session id**, never by match and HR-code, so a wrong or edited match ID cannot link the wrong run.
- A profile header (name, role, HR-code, email, number of halves, average Overall, average per module) appears whenever the rows shown belong to one collector.
- Reviewers: search (HR-code, name, email, match ID, session ID), the same filters as the Admin Sessions tab, and Export CSV of the filtered halves with every column.

## The half

- **Collection details:** method, part, collection start and end, active time, events per minute, whether `collection_incomplete` is set, video file name.
- **Score cards** (when a current comparison exists): Overall and the six modules, with correct, missing, extra, wrong side (not scored), wrong time, wrong extra, miss extra and not-needed-extra counts. These are the **stored** figures; nothing is re-scored.
- **Event Detail table:** verdict, model event and attributes, collector event and attributes, times as MM:SS.mmm, the difference in seconds, module, and which attribute groups differed; filters for event, verdict and module (ANY within a filter, AND across, as on Comparison). The attribute values are rebuilt from `field_events` by the exact time each stored row carries; `eventAttrs.js` is checked against the engine's own function on 3,000 random events. If an event is no longer in the sheet (the session was saved again after the run) the row is shown from what was stored and marked †.
- **The collector's own events are always listed**, even when the half was never compared, or is stale.
- **Video:** the person drops or picks their own file; it plays through a browser object URL. **Nothing is uploaded.** ▶ on a row jumps to that moment.

## Honest limits

1. **This is enforced in the client.** The app reads the Sheet with its own service account, whose key is inside the installer. "A collector sees only their own halves" is therefore a property of this screen, not a server-side wall. What the screen does: a collector's rows are cut down to their own *before they are stored*, the page filters once more, the roster is never read for a collector, and a half that is not theirs is refused before any sheet request. **A modified client could read everything that service account can see:** every collector's sessions, events and scores, and the roster including its plaintext password column. That exposure already exists in every installer and this screen adds none. It is outside this feature's scope.
2. **Event counts** come from `field_events` and appear a moment after the list.
3. Real-sheet size, the real Sheets/Firestore behaviour and WebView2 were **not** exercised by the automated tests, which use a faithful fake of Google Sheets and a test browser.

## What is, and is not, stored for each event

The screen can only show what the sheet holds. Checked against Tag's writer (`buildEventRows`) and the registry:

| Stored in `field_events` | Notes |
|---|---|
| event code, label, numeric id, sequence, video time (ms and readable), time from half start | |
| team, how the team was decided, inferred type, how the type was decided | |
| pairing (`pair_id`, status) and duration | |
| all 18 attribute groups, one column each | `team_side`, `attacking_direction`, `video`, `height`, `body_part`, `extras`, `technique`, `gk_body_state`, `outcome`, `type`, `miscommunication`, `action`, `location`, `launch`, `side`, `direction`, `kind`, `paused` |
| `pass_end`, `play_phase`, `play_side`, `model_shape` | |

| **Not** fully stored | Why |
|---|---|
| **Goal-keeper SAVE events lose one of body state / stance** | The Save-won and Save-success variants ask for both `GK_BODY_STATE` and `GK_STANCE`, and both are written to the single column `attr_gk_body_state`; the writer assigns, so the stance overwrites the body state. Reproduced with the real writer: choosing `GK_BODY_DIVING` and `GK_STANCE_SET` stores only `GK_STANCE_SET`. Past data cannot be recovered. My halves marks these events with ⓘ. A fix needs a new column and a change to Tag's writer. |
| The wall-clock time each event was tagged | Tag captures it; only the local CSV export writes it (`wall_clock_captured_iso`), not the sheet |
| `possessionCertain` | Removed by design; the column is kept blank for old rows |

## Tests

`hrCode` 9, `eventAttrs` 4 (3,000 differential), `sheetIndex` 18 (+ the 15,000-trial stress run), `myHalves` 43, `sessionScores` 94; the real screen against a fake Google Sheets: 86 checks (collector isolation, reviewer search and profile, the half detail, video jump, CSV, access refusal, every failure). Mutation-checked: removing the loader scoping, the page filter, the ownership check, the model-answer exclusion, the dash handling, the permission defaults, or adding the password column each turns tests red. The Admin Sessions tests (28, 81, 46) pass unchanged.
