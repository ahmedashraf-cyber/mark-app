# My halves

A **read-only** screen. A collector rewatches their own halves and sees their errors against the model answer. Reviewer roles get the same view for any collector. It reads the Google Sheet and **writes nothing** (a test asserts there is no write request).

| | |
|---|---|
| Entry | Home page card "My halves" (collectors) / "Halves" (reviewers). Hidden entirely, not shown locked, for a role with neither permission. |
| Code | `src/pages/MyHalvesPage.jsx`, `src/components/HalfDetail.jsx`, `EventDetailTable.jsx`, `LocalVideoDrop.jsx`, `HalvesTable.jsx` (a copy of `SessionsTable.jsx`), `src/utils/myHalves.js`, `myHalvesSheet.js`, `sheetIndex.js`, `hrCode.js`, `eventAttrs.js`, `halvesScores.js` (a copy of `sessionScores.js`) |
| Not changed | The Admin Sessions tab (`SessionsTable.jsx`, `sessionScores.js` and `AdminPage.jsx` are byte-identical to the released files), Comparison, the comparison engine, scoring, Tag, Self-Review, Insights, Drill, Scout, Audit |
| Changed elsewhere (intended) | `useAdmin.js` (the two permissions), `adminSheet.js` (two more columns in the Role Access matrix), `SessionSetupPage.jsx` (the home-page card) |

**Two copies on purpose.** My halves needs a table and a scores module that behave slightly differently from the Admin Sessions tab (its own columns, a hidden-filter option, HR-codes compared by `hrCode.js`), and the Admin tab must not change. So `HalvesTable.jsx` and `halvesScores.js` are copies, and each starts with a comment naming its Admin original. **A fix to one belongs in both**, except anything about how HR-codes are compared, which is My halves only.

## Who sees what

Two permissions in the Role Access matrix (appended as the last two columns, so every existing column keeps its position). The defaults are in `capabilities()` like every other permission; a Batch Manager can change them in the matrix, and a column missing from the sheet falls back to the defaults.

| Permission | Default on for |
|---|---|
| `viewOwnHalves` | both collector roles, and Batch Manager, Batch Supervisor, Batch Coordinator, Offline Quality Reviewer, Offline Quality Team Leader, Training Supporter |
| `viewAnyHalves` | the six roles above (not collectors) |

An unknown or empty role gets neither (a typo in the roster fails closed).

## Identity

The HR-code is the signed-in person's own: `roleInfo.code`, resolved from the Supervisor tab by email at sign-in (collectors who log in with an HR-code get the same value). **It is never a typed field.** If it cannot be resolved, the screen says so and reads nothing.

Matching is by `hrCode.js` and applies to **My halves only** (the Admin Sessions tab and every other screen compare codes their own way, so a code with an en dash is found here and not by the Admin HR-code filter). The rule: trim, upper-case, and a typographic dash (U+2010 to U+2015, which includes the en dash, em dash and non-breaking hyphen, and the minus sign U+2212) counts as `-`. As everywhere else in MARK, spaces *inside* a code are ignored. So `a-1650`, ` A-1650 ` and `A–1650` are one person. `A1650` (no hyphen) and `A-16500` are different people, deliberately: guessing would show one collector another's halves.

There is **no Unicode compatibility folding** (so a full-width `Ａ－1650` is not `A-1650`) and **no stripping of invisible characters** (a zero-width space inside a code is not ignored). No real case in the sheets that needs either has been shown; a character the rule does not understand makes a code *not* match, which fails safe: the person sees no halves, never someone else's.

Free-text search is a partial match by nature (typing `a-1650` also finds `A-16500`); the **HR-code filter** is the exact one.

## What it reads, and how much

**Phase 1: the list.** Read once when the page opens (and again on Reload), in parallel, with a step list shown while it loads:

| Tab | How |
|---|---|
| `field_sessions`, `scores`, `session_edits` | whole tab, once. The edit log is needed to tell a stale score from a current one, so the list is not shown without it. |
| roster (`Supervisor`) | **reviewers only**, columns **A to D** only: the password column is never requested |

The list appears as soon as these are in. It does **not** wait for `field_events`.

**Phase 2: the event counts.** Column A of `field_events` is read **once** (one column, not the tab); the number of events per listed session is counted from it and shown in the Events column. Until then the list shows "Counting events…". If this read fails the list stays usable and says so.

**Opening a half.** Only the rows of that half are fetched, through `sheetIndex.js`:

| Tab | How |
|---|---|
| `field_events` rows (the half's own events, and the model's) | the index built in phase 2, then a range request for just those rows |
| `comparison_detail` rows | column A of that tab is read the first time a half with a stored run is opened, then kept |

`field_events` has 39 columns and every event of every session, so reading it whole is not workable (a Google file is capped at 10 million cells). **No code path reads a whole big tab**: the interface `sheetIndex.js` works through has no "read everything" call.

- Column A of each big tab is read **once per session of the screen** and kept in memory; **Reload clears it**.
- It is re-read only when something does not add up: a fetched row does not carry the expected session id, or the row count is not what the index said (this is what a re-saved session, or rows inserted above, look like). It then re-indexes and retries, up to three tries in all. If it still cannot trust the rows it stops with a clear message and a **Reload sheets** button; it does not fall back to reading the tab.
- An answer of **no rows** is re-checked once: column A is read again before the screen says "no events", so a collector who has just saved is not told their half is empty. Cost: opening a half that really has no events costs one extra column-A read each time.
- **What this does not catch** (accepted; Reload clears it): rows for the *same* session added after column A was read, when some of that session's rows were already indexed. Nothing fetched looks wrong; the new rows are only missing. In a synthetic test that changes the sheet at a random moment in every trial, 42 of 300 results were incomplete this way; none ever contained a row of another session.

## The list

One row per session: match ID, teams, half and part, save date, collection method, number of events, collection speed (events per minute), and the latest score (Overall, A, B, C, D, TO, Pressure).

- No row in `scores`: **Not compared**, never 0%.
- A module with no model events, or a run older than the module scores (v7.8.85): **-**, never 0% or 100%.
- A run is **stale** when the session's `match_id` or `half` was edited (per `session_edits`) after the run: flagged "Stale, match changed" and never shown as the current score. It is left out of averages and its numbers are blank in the CSV.
- The same half tagged twice: both sessions are listed, newest first.
- Model answer sessions (`is_model = 1`) are **never listed to a collector**, including one recorded under their own HR-code. Reviewers see them labelled "Model answer".
- Scores are matched to sessions by **session id**, never by match and HR-code, so a wrong or edited match ID cannot link the wrong run.
- A profile header (name, role, HR-code, email, number of halves, average Overall, average per module) appears whenever the rows shown belong to one collector.
- Reviewers: search (HR-code, name, email, match ID, session ID), the same filters as the Admin Sessions tab, and Export CSV of the filtered halves with every column (a local file saved through the system dialog: the only thing this screen writes anywhere, and only for reviewers).

## The half

- **Collection details:** method, part, collection start and end, active time, events per minute, whether `collection_incomplete` is set, video file name.
- **Score cards** (when a current comparison exists): Overall and the six modules, with correct, missing, extra, wrong side (not scored), wrong time, wrong extra, miss extra and not-needed-extra counts. These are the **stored** figures; nothing is re-scored.
- **Event Detail table:** verdict, model event and attributes, collector event and attributes, times as MM:SS.mmm, the difference in seconds, module, and which attribute groups differed; filters for event, verdict and module (ANY within a filter, AND across, as on Comparison). The attribute values are rebuilt from `field_events` by the exact time each stored row carries; `eventAttrs.js` is checked against the engine's own function on 3,000 random events. If an event is no longer in the sheet (the session was saved again after the run) the row is shown from what was stored and marked †.
- **The collector's own events are always listed**, even when the half was never compared, or is stale.
- **Video:** the person drops or picks their own file; it plays through a browser object URL. **Nothing is uploaded.** ▶ on a row jumps to that moment.

## Honest limits

1. **This is enforced in the client.** The app reads the Sheet with its own service account, whose key is inside the installer. "A collector sees only their own halves" is therefore a property of this screen, not a server-side wall. What the screen does: a collector's rows are cut down to their own *before they are stored*, the page filters once more, the roster is never read for a collector, and a half that is not theirs is refused before any sheet request. **A modified client could read everything that service account can see:** every collector's sessions, events and scores, and the roster including its plaintext password column. That exposure already exists in every installer and this screen adds none. It is outside this feature's scope.
2. **A collector's client still downloads every collector's `field_sessions`, `scores` and `session_edits` rows** (the tabs cannot be filtered on the server) and keeps only their own. Reading is by whole small tab; only the big tabs are read by index.
3. **The one gap in the row reading** is described above (rows added for the same session after column A was read). Press Reload.
4. **Copy drift.** `HalvesTable.jsx` and `halvesScores.js` are copies (see the top of this file).
5. Real-sheet size, the real Sheets/Firestore behaviour and WebView2 were **not** exercised by the automated tests, which use a faithful fake of Google Sheets and a test browser.

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
| **Goal-keeper SAVE events lose the body state** | The Save (Won) and Save (Success / SE) variants ask for both `GK_BODY_STATE` and `GK_STANCE`, and both map to the single column `attr_gk_body_state`; the writer assigns, so the stance overwrites the body state. Reproduced end to end: events tagged on the real Tag screen (Diving + Prone, Standing + Moving) were stored correctly by Tag and written to the sheet by the real save function as `GK_STANCE_PRONE` and `GK_STANCE_MOVING` only; a Shot, which has no stance question, kept its `GK_BODY_DIVING`. The body state is **not in the sheet** (nor in the local CSV, which uses the same writer). Tag's own copy of each event (`mark_collected_events` in Firestore) holds both, and a completed save does not delete it, so it may still exist; that is **not verified** against the live database. My halves marks these events with ⓘ. No fix has been made. |
| The wall-clock time each event was tagged | Tag captures it; only the local CSV export writes it (`wall_clock_captured_iso`), not the sheet |
| `possessionCertain` | Removed by design; the column is kept blank for old rows |

## Tests

Unit tests in the repository: `hrCode` 13, `eventAttrs` 4 (the engine's own `attrSummary` run on 3,000 random events), `sheetIndex` 31 (one accepted gap reported, and 300 randomised trials that never return a row of another session), `myHalves` 43, `halvesScores` 94. The Admin originals `sessionScores` (91) are unchanged from the release.

Screen level, against a fake Google Sheets and a test browser (these harnesses are **not in the repository**): the original author reported 86 checks, which have not been re-run; the review-fix branch was checked with a separate 43-check suite covering progress and list-before-counts, collector isolation, column A read once, Reload, a shifted sheet, a persistently changing sheet (error with Reload, no whole-tab read), a half whose events were saved after column A was read, a half that has none, a failed counts read, the reviewer roster read (A to D only) and the dash rule being My halves only. My checks of the released Admin screens (81 + 28 + 46) pass against this branch.
