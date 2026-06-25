# Hudl Egypt — Collection-Ops Ecosystem

Three apps run the Hudl Egypt football-data collection operation. They share one
set of people (collectors, reviewers, supervisors) and one quality concept
(per-module scores). This document is the map; each app has its own detailed
docs.

```
                    ┌─────────────────────────────────────────┐
                    │   StatsBomb "Tag Once" collection app     │
                    │   (the source of all event data;          │
                    │    MARK reads its Apollo cache via a       │
                    │    bridge injected into app.asar)          │
                    └───────────────┬───────────────────────────┘
                                    │ events, amendments, telemetry, identity
                                    ▼
   ┌──────────────┐        ┌─────────────────┐        ┌─────────────────────────┐
   │    FIELD     │◀──────▶│      MARK       │        │  Video Feedback /        │
   │ (flowops)    │ scores │ (mark-app)      │        │  Performance Dashboard   │
   │ web ops app  │        │ desktop review  │        │  (feedback-dashboard)    │
   └──────────────┘        └─────────────────┘        └─────────────────────────┘
   training ops,           Scout + Audit review,       collector video feedback +
   batches, KPIs           per-module quality scores    module-score reporting +
                                                         meeting/feedback delivery
```

---

## 1. MARK — desktop review app

- **Repo:** https://github.com/ahmedashraf-cyber/mark-app
- **Stack:** Tauri 2 + React 19, Windows desktop. Firebase Auth + Firestore.
  Reads the StatsBomb collection app's Apollo cache through a **bridge** injected
  into the collection app's `app.asar`.
- **Two modes:**
  - **Scout** — live review: the reviewer plays the match video (synced to the
    collection app) and tags errors with keyboard shortcuts.
  - **Audit** — QA review: pulls the collection app's already-collected data and
    scores it (overall A/B/C score + the new per-module scores), listing every
    amendment the reviewer made with click-to-seek.
- **Current version:** 7.5.7 (2026-06-24). See `CHANGELOG.md`, `DECISIONS.md`,
  `MARK_CONTEXT.md`, `MODULE_SCORES.md` in that repo.
- **Key mechanisms:** persistent embedded bridge (auto-loads on every collection
  app page), telemetry-based reviewed-events counting, identity resolution from
  `EventHistory.authorInfo.hrcode`, per-module quality scoring.

## 2. FIELD — training operations web app (flowops)

- **Repo:** https://github.com/ahmedashraf-cyber/flowops
- **Live:** https://ahmedashraf-cyber.github.io/flowops/index.html
- **Stack:** single HTML file. Firebase Auth + Firestore, Google Sheets API,
  EmailJS, Chart.js. Dark-first Apple-style UI; accent `#E8590C`; fonts Inter /
  DM Sans / JetBrains Mono.
- **Purpose:** the dashboard side of the operation — manages training batches
  end to end (coordination, supervision, training, interviews, matches,
  performance). Quality scores from MARK surface here against people/batches.
- **Roles:** Batch Coordinator, Batch Supervisor, Batch Trainer, Training Manager
  (with role switcher) — DONE. Training Supervisor, Trainee — PENDING.
- See `README.md`, `CONTEXT.md`, `CALCULATOR.md` in that repo.

## 3. Video Feedback & Performance Dashboard — collector feedback app

- **Repo:** https://github.com/eslamsaleh-SB/feedback-dashboard (sibling app;
  local copy was shared as `video-feedback-dashboard.rar`).
- **Stack:** Next.js 14 (App Router) + Tailwind + **Supabase** (Postgres + Auth).
  Uses the **Telegram Bot API** as backing storage for small videos (<20 MB) —
  the bot posts to a group/channel (`TELEGRAM_CHAT_ID = -1004359152674`) and
  serves them back via a Range-aware streaming route. Also has `nodemailer` for
  email. Deploy targets: Vercel (`DEPLOY_VERCEL.md`) or self-host (`DEPLOY.md`).
- **Purpose:** deliver **feedback to collectors** — upload short video clips of a
  collector's mistakes, attach them to the collector, and surface their
  per-module performance so feedback/meetings can be sent. This is the
  "collectors' feedback / how to send the meeting" piece.

### Structure
```
app/
  (app)/                       authenticated area (shared layout + navbar)
    layout.tsx                 loads user + role, renders NavBar
    dashboard/page.tsx         stats + collector filter + video grid
    upload/page.tsx            Admin/Uploader only
    collectors/page.tsx        Admin only (add / edit / delete collectors)
  api/
    upload/route.ts            POST: Telegram sendVideo -> save file_id
    video/[file_id]/route.ts   GET: Telegram getFile -> stream (Range-aware)
  login/page.tsx               sign in / sign up
components/  NavBar · DashboardClient · UploadForm · CollectorsManager
lib/supabase/  client.ts (browser, anon key) · server.ts (session cookie)
supabase/schema.sql            tables + RLS + signup trigger
middleware.ts                  session refresh + route protection
```

### Database (Supabase `schema.sql`)
- `public.profiles` — users; a signup **trigger** gives every new user the
  `Viewer` role by default. Roles: Viewer / Uploader / Admin.
- `public.collectors` — the collector roster (managed in the Collectors page).
- `public.feedback_sessions` — feedback records (the videos + context attached to
  a collector). RLS policies gate read/write by role.

### Scoring data it carries (the analysis-team reference)
Two CSVs ship with it — these are the **authoritative analysis-team scores** that
MARK's per-module scoring is being reconciled against:
- **`Collector Module Score.csv`** (UTF-16, tab-separated; ~2972 rows). Columns:
  `hr_code, module, collector_mod_event_count, collector_score, errors,
  match_count`. This is the source of the reference numbers in
  `mark-app/MODULE_SCORES.md` (e.g. base 86.57% / 47 / 350 for match 1442703 1H).
- **`Freeze Frame Score.csv`** (UTF-16, tab-separated; ~671 rows) — freeze-frame
  module scores.
- A `collector-roster-sql.skill` (a zip with `SKILL.md` +
  `scripts/gen_roster_sql.py`) generates the SQL to load the collector roster.

### How feedback/meetings are delivered
- A collector's clips are uploaded (Admin/Uploader), stored via the Telegram bot,
  and shown on the dashboard filtered per collector.
- `nodemailer` is wired for email delivery. Server-only secrets
  (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, SMTP) live in `.env.local` with **no**
  `NEXT_PUBLIC_` prefix so they never reach the browser.
- The per-module CSVs let the dashboard show *what* a collector did wrong (which
  module, how many errors, the score) alongside the *video* of the mistake — the
  basis for the feedback session/meeting.

### Feedback/meeting delivery — exact mechanism (from `app/api/upload/route.ts`)
The dashboard is richer than the README implies. The upload route:
1. **Pulls videos from Google Drive** (not only Telegram). It accepts a Drive
   folder URL/ID (`extractFolderId`), lists video files via the Drive v3 API
   (`GOOGLE_DRIVE_API_KEY`, folder shared "Anyone with the link",
   `supportsAllDrives=true`).
2. **Creates a `feedback_session`** for the collector with the match name, review
   date, and notes.
3. **Emails the collector a report** via Gmail/`nodemailer` (server-side, awaited
   inline — NOT an internal fetch, because the auth middleware 307-redirects
   cookieless `/api/*` calls, which silently dropped emails in an earlier version).
   The join to find the address is:
   `collectors.hr_code → profiles.hr_code → auth user → email`. The email links
   the collector to the dashboard to view the report, acknowledge it, and add
   notes.

Env vars it needs: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_DRIVE_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, optional `EMAIL_FROM`,
plus `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` for the Telegram storage path.

> The dashboard code lives in its own repo (eslamsaleh-SB/feedback-dashboard).
> The local copy used for this write-up was `video-feedback-dashboard.rar`. When
> working on it, clone/obtain that repo directly rather than relying on this
> summary — treat this as the map, not the source.

---

## Shared concepts across the three apps

- **People:** collectors, reviewers, supervisors — identified by HR code
  (`A-####`) and `legacy_id`. MARK resolves these from the collection app;
  `users_finalized_*.csv` and the dashboard's roster SQL are the seed lists.
- **Modules:** base, pressure, players, location, extras, freeze-frame (impact &
  squad ignored in MARK's scoring).
- **Quality score:** % clean per module. MARK computes it live from the cache;
  the analysis team computes the authoritative version (the CSVs); the dashboard
  presents it with feedback videos. The **denominator reconciliation** between
  MARK and the analysis team is the main open data question (see
  `mark-app/MODULE_SCORES.md`).
