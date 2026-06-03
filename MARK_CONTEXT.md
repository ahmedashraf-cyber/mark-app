# MARK — Context File
**Version:** 1.0  
**Last updated:** June 2026  
**Companion to:** FIELD (https://ahmedashraf-cyber.github.io/flowops/index.html)

---

## What Is MARK

MARK is a Windows desktop review application for Hudl Egypt's training operation. Reviewers (Batch Trainers) use it alongside the Statsbomb Tag Once collection app to review collector work, tag errors, and auto-calculate quality scores. Results feed directly into FIELD.

**Name origin:** Reviewers mark errors, mark moments, leave their mark on collector quality.

---

## Repos & Access

- **MARK repo:** https://github.com/ahmedashraf-cyber/mark-app
- **FIELD repo:** https://github.com/ahmedashraf-cyber/flowops  
- **GitHub token:** ask Ahmed directly
- **Firebase project:** hudl-training-ops (SAME as FIELD — one auth, one database)
- **Firebase API key:** AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U
- **Google Sheets API key:** AIzaSyDEO-0MZ4-LOdIJ7aIyscgmLWGN5h8MpNI
- **Matches Sheet ID:** 1dPwnYhIOiLUy_aBuVijPH3xtU6kxnEu-8FF115kXjSc

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Desktop shell | Tauri 2 (Windows) |
| UI | React 19 + Tailwind CSS 3 |
| Design | Same as FIELD — dark theme, #E8590C orange, Inter + DM Sans + JetBrains Mono |
| Auth | Firebase Auth — same trainer accounts as FIELD, no second login |
| Database | Firebase Firestore — same project as FIELD |
| Sync | Tauri command → AHK ControlSend → collection app |
| Match data | Google Sheets API (same key as FIELD) |

---

## Session Setup (Dev)

```bash
cd /home/claude/mark-app
npm install
npm run dev   # opens at http://localhost:1420
```

For Tauri desktop build (requires Rust):
```bash
npm run tauri dev    # dev with Tauri window
npm run tauri build  # build .exe installer
```

---

## File Structure

```
mark-app/
├── src/
│   ├── firebase/config.js     # Firebase (same project as FIELD)
│   ├── hooks/
│   │   ├── useAuth.js         # Auth — reads trainer profile from FIELD's Firestore
│   │   └── useSync.js         # Sync — sends keystrokes to collection app
│   ├── data/shortcuts.js      # Tornado shortcuts + MARK-only Y key
│   ├── pages/
│   │   ├── LoginPage.jsx      # Sign in with FIELD credentials
│   │   ├── SessionSetupPage.jsx # Match/half selection + lock check
│   │   └── ReviewPage.jsx     # Core review UI — video, tagging, timeline
│   ├── components/
│   │   ├── ErrorTagModal.jsx  # Modal after key press — select error type
│   │   └── ErrorTimeline.jsx  # Horizontal timeline of tagged errors
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css              # FIELD design tokens (CSS vars)
├── src-tauri/
│   ├── src/main.rs            # Tauri + sync command (Windows API)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── MARK_CONTEXT.md            # this file
```

---

## Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `mark_sessions` | One doc per review session |
| `mark_error_tags` | One doc per error tag |
| `mark_locks` | Half-level lock — matchId_half → reviewerId |
| `mark_match_assignments` | Match → collector mapping |

### mark_sessions schema
```
sessionId, matchId, half, matchName, homeTeam, awayTeam, matchDate,
reviewerId, reviewerEmail, reviewerName,
collectorId, collectorCode,
status: 'in_progress' | 'completed',
isFirstReview: boolean,
totalTaggedErrors, totalReviewedEvents,
qualityScore: 100 - ((errors/events) × 100)  ← INVERTED: higher = better
startedAt, completedAt
```

### mark_error_tags schema
```
sessionId, matchId, half,
reviewerId, reviewerEmail,
errorType: 'wrong_event' | 'wrong_player' | 'confused_with' | 'missing_event',
triggeredKey, triggeredEventId, triggeredEventLabel,
extras: { confusedWith?, missingEvent? },
videoTimeSec,
timestamp, createdAt
```

---

## Sync Mechanism

**Confirmed working** — tested on actual machine with AutoHotkey before building.

```
Reviewer presses key in MARK
  → Tauri command: send_key_to_collection_app(exe, keyCode)
  → src-tauri/src/main.rs
  → Runs AHK script: ControlSend, {key}, ahk_exe Statsbomb Tag Once collection app.exe
  → Collection app video jumps in sync
  → Delay: < 5ms (well within 200ms tolerance)
```

Collection app exe: `Statsbomb Tag Once collection app.exe`  
Window class: `Chrome_WidgetWin_1`  
AHK version required: v1 (AutoHotkey v1.x)

---

## Navigation Shortcuts (same as collection app)

| Key | Action |
|-----|--------|
| → | Forward 600ms |
| ← | Backward 600ms |
| Shift+→ | Forward 200ms |
| Shift+← | Backward 200ms |
| Space | Play / Pause |

---

## Error Tagging Shortcuts (Tornado keys repurposed)

| Key | Event |
|-----|-------|
| S | Half Start |
| E | Pass |
| Q | Pass (Flight) |
| D | Dribble |
| T | Miscontrol |
| W | Reception |
| B | Block |
| R | Ball Recovery |
| F | Clearance |
| G | Goal Keeper |
| A | Tackle |
| V | Interception |
| X | Foul Committed |
| O | Out |
| C | Shield |
| Z | Shot |
| **Y** | **Missing Event (MARK only)** |

Each tag shows modal with: Wrong Event / Wrong Player / Confused With (→ dropdown) / Missing Event (→ dropdown)

---

## Quality Score Formula

```
Quality Score = 100 - ((Tagged Errors / Total Reviewed Events) × 100)
```

Higher = better. 100 = perfect. Reviewer enters Total Reviewed Events manually when pressing Done.

---

## FIELD Integration Points

| Where in FIELD | What it shows |
|----------------|--------------|
| Trainer gate → Review tab | "Open MARK" button + own session history |
| BSup gate → Review dashboard | All trainer sessions + real-time scores |
| BM gate | Aggregate scores across all batches |
| Trainee profile | Their own quality score history |

---

## Build Order (remaining)

1. ✅ Foundation — auth, sync, video player, error tagging, timeline, session management
2. 🔲 FIELD integration — add Review tabs to Trainer/BSup/BM gates in FIELD
3. 🔲 Attitude tracking — session behavior signals stored silently
4. 🔲 Detection integration — session = daily task signal for trainer detection score
5. 🔲 Windows installer — Tauri build pipeline + GitHub Actions

---

## Attitude Tracking (future — store silently now, use later)

- Session duration vs video length ratio
- Pause frequency
- Navigation direction (forward vs backward)
- Error tag distribution across timeline
- Backtrack rate
- Session abandonment
