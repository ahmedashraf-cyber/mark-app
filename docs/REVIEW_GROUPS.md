# MARK — Tag Once "Quality Review Tracker" groups (A / B / C)

Status: **mapping CONFIRMED; extraction shipped as additive, pending on-machine
validation.** The A/B/C category lists and the score formula are confirmed from
Tag Once's own IPC payload. What needed engineering was getting that payload out
with **zero user intervention**. That extraction is now in the bridge
(`bridge_script.js`, v7.7.0) behind full guards, plus a standalone probe to
confirm the path on a real machine before the scores are trusted.

---

## The score

```
Overall = (viewedEvents − errors) / viewedEvents × 100        (already working)
A/B/C   = (viewedInGroup − errorsInGroup) / viewedInGroup × 100
```

- **viewed** = keys the reviewer authored an `event-activation` telemetry for.
- **errors** = keys the reviewer authored an `amendment` for.
- **group membership** = the event key appears under one of that group's
  categories in Tag Once's `categorizedEvents`.
- Reviewer = the author with the most `event-activation` views (they may also
  have some base events — do **not** require `base === 0`).

Confirmed on the test match: Overall 96% (736 viewed / 27 errors); A 100 / B 97 / C 88.

## The confirmed A/B/C mapping

The 6 internal groups from the minified bundle (`carry/defense/looseO/looseD/
flightO/flightD`, investigated in the first pass) are a **different, finer
layer** — the tracker actually buckets events into ~35 named categories, grouped
into A/B/C. Source of truth: the `updateQualityReviewToolList` IPC payload,
`data.qualityCategorizationContext.categorizedEvents` (object: category name →
array of events, each with `.key`).

```
A_CATS = [lineupsAndFormation, substitutions, tacticalShifts, playerOff, playerOn,
          goals, keyPassesBeforeShots, ownGoals, cards, fouls, offside, freeKickPass,
          corners, errors, kickOffs, throughBalls, stoppage, freezeFrame,
          pressuresBeforeShots, refereeBallDrop, endShots, g.K.-Actions-shots]
B_CATS = [Clearances, passRecoveries, interceptions, blocks, dribbles, tackles,
          miscontrols, g.K.-Actions-Other, shields, fiftyFifty]
C_CATS = [ballRecovery, aerialLosts, pressures]
```

The probe warns if Tag Once emits any category not in these lists (so the
mapping can be kept current if StatsBomb adds categories).

## The real problem: zero-intervention extraction

`updateQualityReviewToolList` is only sent while the Event Review Tracker window
is open, and MARK must score without any clicks or visible windows. Why the
first attempts failed, and what works:

| Attempt | Why it failed | Fix |
|---|---|---|
| `ipcRenderer.on('updateQualityReviewToolList')` | The main renderer is the **sender** of that channel; `.on` only sees traffic **from** the main process. | Tap `.send` (outgoing), not `.on`. |
| `.send('requestQualityReviewTrackerData')` | `.send` goes to the **main process**, which forwards to a *different* window — never back to this renderer's own `.on`. | `ipcRenderer.emit(...)` fires the **local** listener in-process — no window, no round trip. |
| Overriding `.send` | Wrapper re-called the **reassigned** `.send` → infinite recursion. | Save `const orig = ipc.send.bind(ipc)` first, call `orig(...)`; keep the tap body O(1). |
| Fiber search for `"qualityCategorizationContext"` | Key is minified; XState state is **circular**, so a `JSON.stringify` scan throws and silently skips those fibers. | Cycle-safe walk (no stringify); match by **value** (category-name keys → arrays) and via XState `getSnapshot().context`. |

### Extraction strategy (layered, in `getCategorizedEvents()`)

1. **Pure read** — cycle-safe walk of the fiber tree (props + hook
   `memoizedState` chain + XState actors) for the live `categorizedEvents`. No
   IPC, no window, no side effects; works even with the tracker closed because
   the parent component always computes the context.
2. **Trigger + tap** — install a non-recursive read-only tap on
   `ipcRenderer.send`, then `ipcRenderer.emit('requestQualityReviewTrackerData',
   {})` to make Tag Once compute-and-send its own data (captured by the tap).
   `.emit` is a no-op if no listener is registered, so it can't crash.
3. **Passive** — the tap runs from bridge startup, so any natural send is also
   captured.

## What shipped (v7.7.0, additive)

- `bridge_script.js`:
  - `A_CATS`/`B_CATS`/`C_CATS`/`ALL_CATS_SET` constants.
  - `installQrtTap()` — correct, non-recursive `.send` tap (restored in the stop
    hook alongside the Apollo link tap).
  - `readCategorizedFromFiber()`, `getCategorizedViaIpc()`, `getCategorizedEvents()`.
  - `computeReviewGroupScores()`.
  - In the `getQAResults` handler: computes `reviewGroupScores`
    (`{ source, overall, A, B, C, categoriesSeen }`) and adds it to
    `qaResultsResponse`. Fully guarded — any failure leaves it `null` and
    changes nothing else (overall scoring and moduleScores are untouched).
- `scripts/find-categorized-events.js` — DevTools probe: runs both extraction
  paths, reports which worked and where, prints per-category counts, flags
  unmapped categories, and shows A/B/C totals to eyeball against the tracker.

## Validate before trusting (same discipline as MODULE_SCORES.md)

1. Run `scripts/find-categorized-events.js` in Tag Once → confirm `chosen path`
   is `fiber` or `ipc-emit` (not `NONE`) and that there are **no unmapped
   categories**.
2. In MARK, click **Get Results** and confirm `reviewGroupScores` matches the
   tracker's A/B/C for the same half (start with the test match: A 100 / B 97 /
   C 88). Check `reviewGroupScores.source` to see which path fed it.
3. Re-check on a 2-collector match and an ET half before fully trusting.

## UI (next step)

A `ReviewGroupScores` card in `src/pages/AuditPage.jsx`, fed from
`results.reviewGroupScores`, alongside `ModuleScores`. Not built yet — wire it
once step 2 above passes so the numbers are shown only after they're trusted.
