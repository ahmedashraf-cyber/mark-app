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
- **Every edit:** run a JS/JSX parse check and a brace/duplicate-function guard
  before committing.
- **Custom native ops use `rfd` in Rust** (`pick_video_file`, `save_xlsx_file`)
  rather than the scoped JS fs/dialog plugins — full access, visible dialogs, no
  capability surprises.
