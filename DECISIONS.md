# MARK — Decision Log

A record of *why* MARK works the way it does — the decisions taken, the
alternatives rejected, and the investigations behind them. Read alongside
[CHANGELOG.md](./CHANGELOG.md) (the *what/when*) and
[MARK_CONTEXT.md](./MARK_CONTEXT.md) (the *how*).

---

## 1. Audit redesign — SPEC FROZEN, BUILD ON HOLD

> **Status:** approved spec, intentionally **not built yet** (owner said "hold").
> This section is the source of truth for when we build it.

### The problem we uncovered
Auditing **Bristol City vs Watford, 1H** (matchId `1377503`), the Audit page
reported nonsense: *101 reviewed / 101 edited, ~0.1% quality*. A long forensic
pass through the collection app's Apollo cache explained why, and reshaped the
whole feature.

### What the data actually showed
Per-author roles on the half (1,632 base events total), verified by base counts,
amendment types, telemetry, timing, and build version:

| Author | Role | Evidence |
|---|---|---|
| 5436 | **Collector** | 1,582 base events, worked first |
| **223** | **Real reviewer (corrector)** | 52 added + 243 real fixes; edits span 42/45 minutes |
| 8775 | **Watcher only** | 0 fixes, telemetry covering ~96% of the half, worked *last* |
| 1006 / 3318 / 979 | Enrichment / micro-touches | freeze-frame pipelines, negligible |

Two root-cause bugs in the old logic:
1. **Wrong reviewer signal.** It picked the reviewer as `telemetryAll[0].author`
   and counted *telemetry only* → 101. But telemetry is incomplete and can be
   overwritten by a later pass (8775's). The reviewer's **edits** are immune to
   override (you can't edit an event you didn't review) and showed 223 worked
   across the whole half.
2. **Freeze-frame counted as errors** → fake ~0.1% quality.

**The real numbers for 223:** total 1,632 · 243 real corrections · 52 added ·
**real quality ≈ 85% accuracy (≈ 82% counting omissions)** — *not* 101 / 0.1%.

### The agreed design (frozen)
1. **Reviewer auto-detected** by combined signals, **weighted to real fixes,
   telemetry as tie-break**. A pure watcher with **0 fixes is never** the
   reviewer (the safeguard that fixes the original bug).
2. **Reviewed = the reviewer's own viewed-by** (base events ≤ 500 ms of *their*
   `event-activation` telemetry). **Never assume the whole half** — reviewers
   don't always review all of it.
3. **Errors = real corrections (edits + deletions, freeze-frame EXCLUDED) +
   added events** (collector omissions count as errors — owner confirmed).
4. **Quality = (reviewed − errors) / reviewed**, reviewer-attributed (collector
   self-fixes don't count).
5. **Persist & lock (ideal workflow).** First audit run for a
   `(match, half, reviewer)` → compute → **save to the database (Firebase)** →
   **lock**. Re-opening loads the saved snapshot; a later reviewer entering the
   half can never alter it. This is what defeats the override in practice:
   capture early, freeze.
6. **Outlier mode** (auto-triggers when edits exceed surviving viewed-by — proof
   telemetry was overwritten): reconstruct an **approximate** reviewed set from
   *all* signals (telemetry ∪ edits ∪ edit-span coverage, later reviewer's
   telemetry as a proxy over that span), clearly labelled "approximate."

### Caveat
Touches `bridge_script.js` (counting), the audit page (display + formula), and
the Firebase save. Will not ship until reconfirmed by the owner.

---

## 2. Keyboard shortcuts (v7.3.3)

The owner reissued the authoritative key map. Each change was id-anchored to
avoid transient collisions, applied to **both** `shortcuts.js` (behaviour) and
`EventsSidebar.jsx` (labels). Decision: keep existing keys for unchanged events
to preserve muscle memory; only remap the seven below.

`A` and `J` were unused; `M`, `N`, `L` freed up. Verified zero duplicate keys.

---

## 3. Removing Missing Event (v7.3.3)

`Q` was needed for Pass (First time), but `Q` was the Missing Event key.
Options presented: move Missing Event to a freed key, make it mouse-click only,
or remove it. **Owner chose to remove it entirely.** Important detail surfaced
first: Missing Event had **no mouse path** — `Q` was its only trigger — so a
naive key removal would have silently orphaned it. Removal was therefore done
properly (card + handler + constant + dead `ErrorTagModal.jsx`), and historical
tags preserved via the stored `tag.isMissing` flag.

---

## 4. Conditional extra additions (v7.3.5)

The sheet taxonomy was missing options under specific event+error-type
conditions. Rather than edit the auto-generated `tagging_scenarios.js`, we added
a **MARK override layer** (`MARK_EXTRA_ADDITIONS`). Decisions confirmed with the
owner via pop-ups:
- Additions are **single-pick** (flag → team), not the sheet's two-step
  pick-then-correct flow.
- Pass keeps its existing Left↔Right "Wrong side"; a **plain "Wrong Side"**
  option is *added alongside*.
- Tackle's "Wrong extra" is a **generic single-pick flag** (it had no
  wrong-extra data, so this is what makes the error type appear at all).

---

## 5. Native file ops over scoped JS plugins (v7.3.6)

The export download wrote silently through the scoped `@tauri-apps/plugin-fs`
with a browser fallback that is a no-op in a desktop webview → clicks looked
dead. **Decision:** do native file ops in **Rust via `rfd`** (matching the
existing `pick_video_file`). New `save_xlsx_file` shows a real save dialog and
writes with full fs access. General principle going forward: prefer Rust+`rfd`
for file open/save so dialogs are visible and capabilities never silently block.

---

## 6. Auto-updater version hygiene (v7.3.1)

A drifted `CURRENT_VERSION` (7.3.0) above the published release (7.2.1) froze the
updater for everyone. **Decision/rule:** the version must be bumped in lockstep
across all files, and every new release must be strictly greater than any value
shipped in a prior build. Codified at the top of [CHANGELOG.md](./CHANGELOG.md).

---

## 7. Version numbering & on-screen version (owner rules)

Two operational rules set by the owner:

1. **Number sequence.** The patch digit runs `0→9` only, then rolls to the next
   minor with patch reset to `0`: `…7.3.9 → 7.4.0 → 7.4.1 …`. Two-digit patches
   like `7.3.10` are not used. (7.3.10 / 7.3.11 during the Google-Sheets work are
   a pre-rule exception; the next clean bump rolls to **7.4.0**.)
2. **On-screen version must always match the release**, in BOTH places it shows:
   the OS **window title bar** (synced from `package.json` by
   `scripts/sync-version.js`) and the in-app **top-left logo** (`CURRENT_VERSION`
   in `useUpdateCheck.js`, rendered by `SessionSetupPage.jsx`). The standard
   version bump updates both — confirm before shipping.

Both are codified in the Conventions section of [CHANGELOG.md](./CHANGELOG.md).

---

## 8. Collector / reviewer identity from the collection app (v7.5.1)

**Problem.** MARK only had numeric author IDs (e.g. #2909). We needed real
people: HR code (`A-####`), name, email.

**Breakthrough (proven live).** Identity flows through the collection app's
Apollo GraphQL operation `EventHistory($eventKey:String!)` → field `authorInfo`
is a JSON blob `{id, email, firstName, middleName, lastName, hrcode (LOWERCASE!),
legacyId}`. `legacyId` === MARK's numeric author. The bridge taps
`client.queryManager.link` (NOT `client.link`, which carries no traffic), and
auto-sweeps all distinct authors of a match by re-issuing `EventHistory`, with
socket-aware retry (the graphql-ws WebSocket drops when idle → "Socket closed";
retry on reconnect).

**Roster backbone.** `users_finalized_*.csv` (columns
`legacy_id, hr_code, full_name, email, job`; ~1912 rows) seeds a persistent
Firestore roster, merged with live-harvested identities. Some IDs are missing
from the CSV (e.g. 2909, 1935); some collectors show only a numeric legacyId with
no `A-` code (e.g. Karim Ahmed 1006245) — MARK then displays the number, which is
expected, not a bug.

**Recommendation (not yet done):** get the roster as a scheduled API pull from
the Hudl/StatsBomb data team instead of a static CSV, to fix staleness/coverage.

---

## 9. Collector / reviewer detection rules (corrected, v7.5.1)

- **COLLECTOR** (can be MULTIPLE per half): `views == 0` AND
  `(base + refinement) > 600`. Fallback: top base-author if none clears the bar.
- **REVIEWER** (can be MULTIPLE): telemetry/`event-activation` authors MINUS
  collectors, who made ≥1 change. **Key fix:** the reviewer signal is **views**,
  not amendments. A viewer with 0 changes is a *playthrough*, dropped.
- Validated example (a 2-collector half): Alaa (1319 base, 0 views) + Mohamed
  (2305 refinement, 0 views) = 2 COLLECTORS; Omar (2611 views) = REVIEWER; Eslam
  (172 views, 0 changes) = playthrough, dropped.

---

## 10. Per-module quality scores — method chosen, denominator unresolved (v7.5.4)

Full detail in [MODULE_SCORES.md](./MODULE_SCORES.md). Summary of decisions:
- Score = **% clean** per module; error unit = the **event**; **no unique events**
  (one event can hit several modules).
- Denominator = **events the reviewer VIEWED** that have the module; pressure is
  carved out of base (scored on `pressure-start`/`-end` events).
- **Added/missed events count as BASE only** (NOT the partials) — the analysis
  team's reference (location 0 / players 0) proved the "added hits all partials"
  variant wrong.
- **Deletions kept**, **added counted** (user's explicit choice → base ~375).
- **OPEN:** MARK's denominators run ~3–7% higher than the analysis team's
  reference (base 375 vs 350). User chose to keep MARK's method until they
  confirm the team's exact "reviewed events" rule; scores may be tuned then.
  Claude did NOT certify MARK's method as more correct than the team's.

---

## 11. The bridge-disconnect fix took two tries (v7.5.2 wrong, v7.5.5 right)

**Symptom.** After moving between modes/halves/matches several times, MARK showed
"Bridge disconnected" and the only recovery was a full MARK logout + login AND
Ctrl-R on the collection app.

**Wrong fix (v7.5.2).** Assumed the *bridge's* localhost socket was the problem
and decoupled it from video attachment. Shipped without a live test. It did NOT
resolve the issue (a good lesson: do not claim a connection fix works without
running it).

**Right fix (v7.5.5).** The breakage was on the **MARK side**: `useSync.getWs()`
returned early when the singleton socket was already open, **without re-wiring the
freshly-mounted page's `onStatusChange`** — so a remounted AuditPage stayed stuck
on `disconnected`. Fixed by re-reporting the real socket state on every mount and
adding a 2 s self-healing reconnect (Audit sends no sync signals, so it never
reconnected on its own).

**Lesson:** reasoning a fix from code is fine, but a fix to a *runtime
connection* behaviour is not "done" until the live acceptance test passes. State
that honestly rather than declaring victory on inference.

---

## 12. Scout vs Audit are independent activities (v7.5.5)

The lock + completed-session machinery was Scout-only and ignored mode, so a
Scout session blocked Audit on the same match/half. Decision: make locks and
sessions **mode-aware** (`matchId_half_mode`, `mode` stored on the session doc).
Scout and Audit can now both use any match/half independently. This also gives
Session History the `mode` field needed to list Audit sessions.
