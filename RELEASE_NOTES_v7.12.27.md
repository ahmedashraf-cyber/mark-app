## MARK v7.12.27 — Tag: no more stale match IDs. Admin: session scores and Edit session

Download the `.msi` or `.exe` installer below. Requirements: Windows 10+.

### Tag — a new session now starts blank
After **Start New Session** the start screen used to be skipped, and the next video was saved under the *previous* Match ID and Part (with empty team names). That is fixed: Match ID, Part and the collection method are cleared after every save, and you choose them again.
- Once the model answer is found, a line shows what you typed: **Match 1366067 - Arsenal vs Chelsea - 1st half**. A wrong Match ID or Part shows up as the wrong teams or half before you start.
- If you already saved this half of this match, you get **"You already saved this half for this match."** and Continue stays off until you click *I want to collect it again*. Offline, this check never blocks you.
- The **Save screen** shows the video file name next to the Match ID.

### Admin (Batch Manager only) — new Sessions tab
- **Every saved session in one table, with its latest score:** Overall, A, B, C, D, TO and Pressure, the counts (correct, missing, extra, wrong time, wrong extra, miss extra, model events), the run time and the model session it was compared against.
- A session that has not been compared shows **"Not compared"** (never 0%). A module with no model events shows **"-"**. Model answers show **"Model answer"**. Several runs: the newest is shown with an **"N runs"** badge that lists the earlier ones.
- **"Stale, match changed"**: if a session's Match ID or half was edited after its last comparison, its score is flagged and left out of the averages and the CSV.
- **Filters** (all together, with a live "Showing 47 of 312 sessions"): search, Match ID, half, part, collector, role, model/collector, compared status, collection method, score ranges (Overall, TO, Pressure), module has data, save dates, model answer exists, flags, video file, number of events. **Clear all filters** resets them.
- **Sort** by any column (newest first by default), **choose columns** (remembered until you close the app), **Export CSV** (the filtered rows, every column), **Reload**. It reads the sheets once when you open the tab, not on every filter.
- **Edit session**: click a row to correct its Match ID or half. Every change is logged (who, when, old and new value) in a `session_edits` tab. If the session already has comparison results, you are warned.

### Good to know
- After a Match ID or half is edited, **Comparison will show the earlier run as "no changes detected" and write nothing**, so the old score rows keep the old match until they are removed. The Sessions table shows these as "Stale".
- The Events column is counted from the `field_events` tab after the table opens, so it fills in a moment later.
- Nothing about Comparison, scoring, Scout, Audit, History, Insights, Drill or Self-Review changed.
