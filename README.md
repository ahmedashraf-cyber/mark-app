# MARK — Review App
> **v2.9.8** · Tauri 2 + React 19 · Windows desktop · Hudl Egypt

MARK is a Windows desktop app for Batch Trainers at Hudl Egypt. Reviewers watch match video, tag collector errors using the same keyboard shortcuts as the Statsbomb collection app, and quality scores feed automatically into [FIELD](https://ahmedashraf-cyber.github.io/flowops/index.html).

---

## Install

Download the latest `.msi` or `.exe` from [Releases](https://github.com/ahmedashraf-cyber/mark-app/releases).

**Requirements:** Windows 10+, AutoHotkey v1 (for bridge injection)

---

## Documentation

| File | Contents |
|------|----------|
| [MARK_CONTEXT.md](./MARK_CONTEXT.md) | Full architecture, data schemas, file structure, Firestore collections, sync mechanism, TagPanel workflow |
| [SYNC_PROBLEM_CONTEXT.md](./SYNC_PROBLEM_CONTEXT.md) | Complete history of the sync problem — 20 failed approaches + the winning solution |
| [TAGPANEL_CONTEXT.md](./TAGPANEL_CONTEXT.md) | Error tagging workflow — all events, error types, per-event extras, wrong event corrections |

---

## Quick Start (Dev)

```bash
git clone https://ahmedashraf-cyber:TOKEN@github.com/ahmedashraf-cyber/mark-app.git
cd mark-app
npm install
npm run dev          # browser preview
npm run tauri dev    # full Tauri window
npm run tauri build  # Windows .msi + .exe
```

---

## Keyboard Shortcuts

| Key | Event |
|-----|-------|
| E | Pass (all types) |
| S | Shot |
| W | Reception |
| T | Miscontrol |
| K | Tackle |
| D | Dribble |
| V | Interception |
| R | Ball recovery |
| B | Block |
| F | Clearance |
| P | Pass recovery |
| I | Pass interception |
| 0 | Fifty fifty |
| X | Foul committed |
| G | Goal keeper |
| H | Hold up duel |
| Y | Positioning duel |
| L | Separation duel |
| M | Leg stretch duel |
| C | Shield |
| O | Out |
| Q | Missing Event (MARK only) |
| → | Forward 400ms |
| ← | Backward 400ms |
| Shift+→ | Forward 40ms |
| Shift+← | Backward 40ms |
| ↑ | Play / Pause |
| ESC | Cancel tag |
