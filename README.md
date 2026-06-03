# MARK — Review App

> Companion to [FIELD](https://ahmedashraf-cyber.github.io/flowops/index.html) — Hudl Egypt Training Operations

## What is MARK

MARK is a Windows desktop app for Batch Trainers (reviewers) at Hudl Egypt. It lets reviewers watch match video and tag errors in collector work, with automatic quality score calculation and real-time results in FIELD.

## Install

Download the latest `.msi` or `.exe` installer from [Releases](https://github.com/ahmedashraf-cyber/mark-app/releases).

**Requirements:**
- Windows 10 or later
- AutoHotkey v1 (for collection app sync) — download from [autohotkey.com](https://www.autohotkey.com)

## How It Works

1. Sign in with your FIELD account (same email + password)
2. Select a match and half to review
3. Load the match video (drag and drop)
4. Navigate with arrow keys — collection app syncs automatically
5. Press event keys (E, Q, D, T…) to tag errors
6. Press Y for missing events
7. Press Done → enter reviewed events count → quality score calculated

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| → | Forward 600ms |
| ← | Backward 600ms |
| Shift+→ | Forward 200ms |
| Shift+← | Backward 200ms |
| Space | Play / Pause |
| E,Q,D,T,W,B,R,F,G,A,V,X,O,C,Z,S | Tag error on event |
| Y | Missing event |
| ESC | Cancel / Close modal |

## Development

```bash
npm install
npm run dev          # frontend only (browser)
npm run tauri dev    # full Tauri desktop window
npm run tauri build  # build Windows installer
```

Requires: Node.js 20+, Rust stable, Windows SDK (for Windows build)
