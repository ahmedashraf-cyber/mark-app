# MARK — Tag Once "Quality Review Tracker" groups (A / B / C)

Status: **investigation — mapping pending confirmation.** This doc captures what
we know, the tool that resolves the open question, and the plan to implement the
A/B/C review-group scores in the bridge once the mapping is confirmed. Nothing
is shipped in scoring yet — consistent with the discipline in `MODULE_SCORES.md`
and `DECISIONS.md` (never ship a score we can't reconcile with the source).

---

## The goal

Tag Once's **Quality Review Tracker** groups a half's events into **A-Review /
B-Review / C-Review** with counts (example half: **A = 46, B = 126, C = 208**).
MARK needs to replicate the same grouping so it can compute, per group:

```
Score = (viewed events in group − errors in group) ÷ viewed events in group × 100
```

("viewed" and "errors" reuse MARK's existing telemetry/amendment logic — the
same signals used for the per-module scores in `MODULE_SCORES.md`.)

## What we know (from the minified bundle)

`renderer.prod.js` defines **6 internal review groups**, collected in
`Ug = Object.freeze([gg,_g,yg,jg,Cg,Sg])`:

| var  | name      | phase              |
|------|-----------|--------------------|
| `gg` | `carry`   | in possession      |
| `_g` | `defense` | winning ball back  |
| `yg` | `looseO`  | loose ball (mine)  |
| `jg` | `looseD`  | loose ball (opp)   |
| `Cg` | `flightO` | pass in flight (mine) |
| `Sg` | `flightD` | pass in flight (opp)  |

Each group's entry conditions (`rules`) and follow-up events (`postRules`) live
in object `Qg`. The full paraphrased rules are in the issue that opened this
work; the **exact** rules (real payload field names/values) come out of the
discovery script below as `Qg`.

## The open question

The tracker shows only **3** labels but there are **6** groups, so the groups
merge in pairs. **Which pairs?** The letters `A`/`B`/`C` and the string
`"A-Review"` are **not** literals in the bundle — they're built at runtime — so
grepping the minified text can't find the mapping. Reading Apollo cache, fiber
props, and DOM text all came up empty too.

### Leading hypothesis (must be verified, not assumed)

`Ug` lists the groups as three offensive/defensive pairs, so the natural mapping
is **consecutive pairs**:

| Label      | Groups (internal)        | Phase             | Expected count |
|------------|--------------------------|-------------------|---------------:|
| **A-Review** | `carry` + `defense`    | possession regains|            46  |
| **B-Review** | `looseO` + `looseD`    | loose balls       |           126  |
| **C-Review** | `flightO` + `flightD`  | passes in flight  |           208  |

The counts corroborate it (passes are the most frequent event → C largest;
possession-regain phases the rarest → A smallest). Plausible, but a score people
are judged by must **match the source**, so we confirm before shipping.

## How we resolve it — `scripts/find-review-groups.js`

The MARK bridge already runs *inside* Tag Once's renderer (reads the Apollo
cache, taps Apollo's link, walks the fiber tree). Code in that context can read
Tag Once's **live runtime values**, which defeats the minification: names are
minified, values are not.

Paste `scripts/find-review-groups.js` into Tag Once DevTools (F12) on a half
that shows the tracker. It runs four independent strategies:

1. **Webpack module registry (primary).** Hijacks the chunk array to get
   `__webpack_require__`, then reads every instantiated module's exports and
   matches `Ug` (array of the 6 names), `Qg` (object keyed by the names with
   `rules`/`postRules`), and any length-3 config that references the names or a
   "Review" label — by **value**, so minified names don't matter.
2. **Fiber walk.** Dumps any component props/state referencing the group names
   or "review".
3. **DOM scrape.** Reads the rendered A/B/C counts.
4. **Arithmetic derivation (self-check).** Given per-group counts, finds the
   unique disjoint pairing that sums to the A/B/C targets — proves the mapping.

It prints a `=== FINAL ANSWER ===` block and leaves everything on
`window.__MARK_RG__` (also copied to clipboard). **Send that block plus the
recovered `Qg` back to MARK.**

## Implementation plan (once the mapping + `Qg` are confirmed)

Additive, mirroring the `moduleScores` feature — no change to existing scoring:

1. **`REVIEW_GROUP_RULES`** — port the recovered `Qg` (exact rules) into a
   classifier in `src-tauri/src/bridge_script.js`.
2. **`ABC_MAP`** — a single constant `{ 'A-Review': [...], 'B-Review': [...],
   'C-Review': [...] }` from the confirmed mapping (default = hypothesis above).
3. **`classifyReviewGroups(cache, matchId, partId)`** — assign each base event
   to a group via the rules; sum into A/B/C via `ABC_MAP`.
4. **Scores** — reuse the viewed/errors sets already computed for `moduleScores`,
   partitioned by group: `score = (viewed − errors) / viewed × 100` per letter.
5. **Self-verification** — include per-group counts in `qaResultsResponse` and
   warn if the A/B/C sums don't match Tag Once's own tracker counts (the same
   "reconcile with the source" guard used elsewhere).
6. **UI** — a `ReviewGroupScores` card in `src/pages/AuditPage.jsx`, fed from
   `results.reviewGroupScores`, alongside `ModuleScores`.

Until steps 1–2 are confirmed by the discovery script, the classifier is **not**
wired into the response — same "pending confirmation" stance as the module
denominators.
