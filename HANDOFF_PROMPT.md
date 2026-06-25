# HANDOFF PROMPT — Hudl Egypt Collection-Ops (MARK / FIELD / Feedback Dashboard)

> Paste this whole file as the first message in a new Claude chat to continue the
> work with full context. It is written to be self-contained.

---

## Who you are continuing for

I'm Ahmed Ashraf at Hudl Egypt. We run a football-data collection operation with
three apps. You'll mostly work on **MARK** (a Tauri/React desktop review app) and
sometimes **FIELD** (a single-file web ops app). A third app, the **Video
Feedback Dashboard**, delivers feedback to collectors. Full map:
`mark-app/ECOSYSTEM.md`.

## How I want you to work (important)

- **Be honest above all.** If you're inferring rather than knowing, say so. Do
  NOT claim a runtime fix works until it's been tested live — we got burned once
  when a bridge fix was declared done from code reasoning and didn't work
  (v7.5.2 → had to redo as v7.5.5).
- **Investigate before building.** For anything touching the audit scoring,
  bridge, or session/lock logic, read the actual code first. Use read-only
  console snippets in the collection app to validate data assumptions.
- **One build, fixed one-by-one.** When I give several issues, fix them in a
  single build but do them sequentially and validate each (esbuild/parse, brace
  balance, no dup functions) before the next.
- **You are authorized to push directly** (git config below). Builds happen via
  CI on push; I install the .exe manually (the auto-updater is non-functional).
- **Don't disturb validated logic.** The overall audit score and the per-module
  scoring are sensitive. When editing the bridge, verify via `git diff` that
  scoring lines are byte-unchanged.
- Ask me clarifying questions as **pop-ups** (the tappable input tool) — I prefer
  tapping to typing on mobile.

---

## Repos, tokens, workflow

**MARK** — https://github.com/ahmedashraf-cyber/mark-app
- Session start:
  ```
  cd /home/claude && git clone https://github.com/ahmedashraf-cyber/mark-app.git mark_review
  cd mark_review && git config user.email "ahmed.ashraf@hudl.com" && git config user.name "Ahmed Ashraf"
  ```
- Before pushing (fresh clones use a plain remote):
  ```
  git remote set-url origin https://ahmedashraf-cyber:<TOKEN>@github.com/ahmedashraf-cyber/mark-app.git
  git push origin main
  ```
- CI status:
  ```
  curl -s -H "Authorization: token <TOKEN>" "https://api.github.com/repos/ahmedashraf-cyber/mark-app/actions/runs?per_page=3"
  ```
  Tauri Windows builds take ~10–13 min. Releases at `/releases/tags/vX.Y.Z`.

**FIELD (flowops)** — https://github.com/ahmedashraf-cyber/flowops
- Live: https://ahmedashraf-cyber.github.io/flowops/index.html
- Single HTML file. Clone, edit `index.html`, push, wait for GitHub Pages green,
  hard refresh (Ctrl+Shift+R).

**Feedback Dashboard** — https://github.com/eslamsaleh-SB/feedback-dashboard

**TOKEN:** ask me for the current GitHub token at the start (rotated regularly;
the last ones used were `ghp_qcti16...` for mark-app and `ghp_docCD...` for
flowops — confirm with me, don't assume they're still valid).

---

## MARK — current state (as of v7.5.7, 2026-06-24)

Stack: Tauri 2 + React 19 Windows desktop. Firebase project `hudl-training-ops`.
Reads the StatsBomb "Tag Once" collection app's Apollo cache via a **bridge**
injected into the collection app's `app.asar`.

### Versioning rules (STRICT)
- Bump these on every release: `package.json`, `src-tauri/Cargo.toml`,
  `src/hooks/useUpdateCheck.js` (`CURRENT_VERSION`), `src-tauri/tauri.conf.json`.
  (`tauri.conf.json` is also auto-synced by `scripts/sync-version.js` in CI.)
- **Patch digit runs 0→9 only, then roll the minor** (`7.5.9 → 7.6.0`). No
  two-digit patch like 7.5.10.
- **Bridge changes** also require bumping `BRIDGE_VERSION` (line 2 of
  `src-tauri/src/bridge_script.js`) AND the `ASAR_MARKER` in
  `src-tauri/src/main.rs` (`<!-- MARK_BRIDGE_INJECTED vX.Y.Z -->`) so the old
  embedded bridge gets replaced. If you DON'T touch the bridge, leave its version
  alone (it can legitimately lag the app version — e.g. app 7.5.7 / bridge 7.5.4).
- The on-screen version shows in two places (OS title bar + in-app top-left
  logo); both must match the release.
- **Validate every edit:** `node --check` on bridge JS; esbuild parse on JSX;
  brace/paren/bracket balance (python count); `npm run build` (vite, exit 0);
  restore `package-lock.json` after npm churn (`git checkout package-lock.json`).

### The bridge (the heart of MARK)
- Real embedded bridge = `src-tauri/src/bridge_script.js`, compiled via
  `include_str!` and injected by `patch_tag_once_asar` in `main.rs`. (An old
  standalone `patch_v4.js` is STALE — don't put logic there.)
- It is **persistently embedded** in the collection app's `app.html` and
  auto-loads on every page reload. To update it the user must close the collection
  app, click **⚡ Embed Bridge** in MARK, reopen the collection app, and confirm
  the footer shows the new bridge version.
- It connects a localhost WebSocket (independent of video, as of 7.5.2), reads
  the Apollo cache (`window.apollo.client.cache.extract()`), taps
  `client.queryManager.link` for `EventHistory` identity, and responds to
  `getQAResults` with base events, amendments, identities, and `moduleScores`.

### Audit data model (StatsBomb Apollo cache)
- Events: `__typename:'Event'`, fields `category` (base/refinement/amendment/
  telemetry/metadata), `type`, `author` (numeric legacyId), `key`, `partId`
  (1=1H, 2=2H...), `matchId`, `payload`.
- Modules are **separate refinement records sharing the event `key`**.
- Pressure = base event with `payload.name = pressure-start|pressure-end`.
- `payload['required-partials']` lists expected modules.
- Amendments carry a module `type`: base, deletion, location, extras, players,
  camera, added.
- Identity: `EventHistory($eventKey)` → `authorInfo` blob `{..., hrcode
  (lowercase), legacyId}`; `legacyId` === `author`.

### Collector / reviewer rules (validated)
- COLLECTOR (can be multiple): `views==0` AND `(base+refinement) > 600`.
- REVIEWER (can be multiple): telemetry/event-activation authors minus collectors,
  who made ≥1 change (viewers with 0 changes = playthrough, dropped).

### Per-module scores — see `mark-app/MODULE_SCORES.md` (READ THIS)
- Shipped v7.5.4. Score = % clean per module; denominator = reviewer-VIEWED
  events that have the module; pressure carved out of base; added events count as
  base only; deletions kept. Validated on ONE match (1442703 1H: base 90.40%,
  pressure 93.75%, players/location 100%, extras 92.83%).
- **OPEN:** MARK's denominators are ~3–7% higher than the analysis team's
  reference (base 375 vs 350). I'm checking the team's exact "reviewed events"
  rule. Until then keep MARK's method as-is; scores may be tuned after.
- **TODO:** validate on a 2nd match (2-collector, ET half).

### Firestore collections
- `mark_sessions` — Scout sessions (now carry `mode`).
- `mark_audit_sessions` — Audit sessions.
- `mark_error_tags` — Scout error tags.
- `mark_audit_amendments` — Audit amendments (now include `videoTimestamp`).
- `mark_locks` — in-progress locks, keyed `matchId_half_mode` (mode-aware as of
  7.5.5).

### Known constants
- Firebase apiKey: `AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U`, project
  `hudl-training-ops`.
- Roster seed CSV: `users_finalized_*.csv` (`legacy_id, hr_code, full_name,
  email, job`, ~1912 rows).
- Admin email (sees all sessions): `ahmed.ashraf@hudl.com`.

### What shipped this session (v7.5.1 → 7.5.7) — see CHANGELOG
7.5.1 identity + role rules · 7.5.2 bridge-connect attempt (failed) · 7.5.3 Audit
UI (replace video, click-seek, filters, 2/3 layout) · 7.5.4 per-module scores ·
7.5.5 four fixes (bridge reconnect REAL fix, mode-independent sessions, results
persist, Audit in history+replay) · 7.5.6 Audit video shortcuts · 7.5.7 split
CHANGE column into EVENT ASPECT + EDIT TYPE.

### Open items / next steps
1. **Module-score denominator** — reconcile with analysis team (350 vs 375), then
   tune. (Blocking the scores being "authoritative".)
2. **Validate scoring on a 2nd match** (2-collector, ET half).
3. **#2 replay** only seeks correctly for audits saved on 7.5.5+; older ones seek
   to 0:00 (no per-amendment timestamp stored).
4. Consider an API roster pull instead of the static CSV.

---

## FIELD — current state

Single HTML file. Dark Apple-style, accent `#E8590C`, fonts Inter/DM Sans/
JetBrains Mono. All dropdowns use the `nx-select-wrap` system; all screens use
`class="screen"` + the `app-shell` grid. **Never** modify CSS variables or the
nx-select system without checking existing code first.
- Firebase project `hudl-training-ops`; Sheets API key
  `AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI`.
- Interview sheet `190Zih7R1HswY2yVxl4WanfH-QhGlt4X8bOBteFrNtiY` (tabs Interview
  Score 1/2/3; batch=r[17]; status col L includes 'accept').
- Matches sheet `1dPwnYhIOiLUy_aBuVijPH3xtU6kxnEu-8FF115kXjSc`.
- Roles done: Batch Coordinator, Batch Supervisor, Batch Trainer, Training
  Manager (role switcher). **Pending: Training Supervisor, Trainee.**
- Rules: clone fresh at session start; run JS brace balance after each edit;
  check for duplicate functions before pushing; after pushing tell me to wait for
  GitHub Pages green then hard-refresh.

---

## Feedback Dashboard — current state

Next.js 14 + Tailwind + Supabase + Telegram-bot video storage + nodemailer email.
Delivers per-collector video feedback and presents the analysis-team module
scores. Carries the authoritative `Collector Module Score.csv` and `Freeze Frame
Score.csv` (the reference MARK is being reconciled to). Full detail in
`mark-app/ECOSYSTEM.md`.

---

## First thing to do in the new chat

1. Ask me for the current GitHub token(s).
2. Clone the relevant repo fresh and read its `*.md` docs
   (`ECOSYSTEM.md`, `CHANGELOG.md`, `DECISIONS.md`, `MARK_CONTEXT.md`,
   `MODULE_SCORES.md` for MARK).
3. Ask me what we're working on today, and whether I've heard back from the
   analysis team about the module-score denominator.
