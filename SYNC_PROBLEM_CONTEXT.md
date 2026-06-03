# MARK ↔ Collection App Sync — Full Technical Context

> Living document. Tracks the keyboard-sync problem between MARK and the Tag Once
> Collection App, every approach tried, decisions made, and current status.
> Last updated alongside MARK v1.3.0.

---

## 1. The Project

**MARK** is a Windows desktop review app:
- Tauri 2 = Rust backend + React 19 frontend running inside a Chromium **WebView2**
- Companion to **FIELD** (web-based training-ops platform for Hudl Egypt)
- Reviewers watch match video and tag errors in data-collection work

**The Collection App** ("Statsbomb Tag Once collection app"):
- Separate Windows desktop app built with **Wails** (Go backend + Chromium **WebView2** frontend)
- Closed source — we cannot modify it
- Window title: `Tag Once Collection App / 2.0.0-tornado-2026.5.2-tag-once / staging`
- DevTools (F12) disabled
- Arrow keys move its video regardless of where you click on the page (global page shortcut)

Both apps run side by side on the reviewer's machine.

---

## 2. The Goal

When a reviewer presses an arrow key in MARK:
- MARK's own video moves forward/backward (always worked)
- **The Collection App's video should move the same amount at the same time** ← the sync

The dream: press arrow → both videos move → no mouse interaction → MARK keyboard stays fully responsive.

---

## 3. Current State (v1.3.0)

- Sync **functions** — pressing an arrow in MARK does move the Collection App's video
- Green dot shows "Collection app synced"
- **Remaining friction:** after each sync, MARK's Chromium webview loses internal keyboard
  focus, so the reviewer must click once inside MARK before the next arrow key registers

---

## 4. The Core Technical Barrier

**Chromium maintains its own internal keyboard-focus state, separate from Windows OS focus.**

The working sync method (`SendInput`) briefly switches OS focus to the Collection App to
deliver the keystroke, then switches back to MARK. When focus returns to MARK:
- Windows says "MARK is the foreground window" — true at OS level
- Chromium inside MARK says "no real user interaction happened, I'm staying asleep"
- Next keypress reaches the OS window but Chromium ignores it until a **real physical mouse
  click** wakes it

Widely-documented, essentially-unsolved problem across Tauri, Electron, WebView2, Flutter.
Confirmed via Tauri issues #5464, #208, #13919, MicrosoftEdge/WebView2Feedback, and many
Stack Overflow threads. `SendInput`-injected input carries the `LLMHF_INJECTED` flag which
Chromium detects and treats as untrusted.

---

## 5. Every Approach Tried

| #  | Approach | Result | Why it failed |
|----|----------|--------|---------------|
| 1  | PostMessage WM_KEYDOWN to Collection top-level | FAIL | Chromium ignores PostMessage'd keys |
| 2  | PostMessage to Chrome_WidgetWin_1 child | FAIL | Wrong child window |
| 3  | WM_SETFOCUS to MARK Chrome child | FAIL | Chromium ignores focus msgs not from real user |
| 4  | WM_LBUTTONDOWN/UP fake click via PostMessage | FAIL | Rejected by input-integrity check |
| 5  | Global WH_KEYBOARD_LL hook forwarding keys | FAIL | Collection App (Chromium) ignored forwarded keys |
| 6  | PostMessage to Chrome_RenderWidgetHostHWND deep child | FAIL | Documented unreliable by Chromium team |
| 7  | Tauri window.set_focus() instead of raw Win32 | FAIL | Doesn't fully trigger WebView2 MoveFocus here |
| 8  | **SendInput keyboard + ALT-trick + SetForegroundWindow** | **WORKS, needs click** | Current working baseline |
| 9  | SendInput fake mouse click BEFORE focus switch | FAIL | Chromium detects LLMHF_INJECTED, ignores |
| 10 | SendInput fake mouse click AFTER focus returns | FAIL | Same injected-flag rejection |
| 11 | JS window.focus() + document.body.focus() after invoke | PARTIAL | Worked for exactly 2 presses; body not persistently focusable |
| 12 | JS hidden tabIndex=0 div as focus target | FAIL | Black-screen crash (hook-order bug), then no improvement |
| 13 | JS window focus-event listener + documentElement.focus() | FAIL | No improvement |
| 14 | CDP Input.dispatchKeyEvent | FAIL | CDP connects, but key needs a focused element in page |
| 15 | CDP Runtime.evaluate synthetic KeyboardEvent | FAIL | Synthetic events are isTrusted:false; app ignores |
| 16 | CDP Runtime.evaluate direct video.currentTime += | FAIL | Not a standard HTML5 video, or wrong CDP page target |

---

## 6. The CDP Chapter (major detour)

A developer consultation pointed to the **Chrome DevTools Protocol (CDP) backdoor** —
theoretically perfect because it injects directly into Chromium's V8 engine, bypassing all
Windows focus mechanics.

**Decisions made for CDP:**
- Changed workflow so **MARK launches the Collection App** (Rust `std::process::Command`)
  with env var `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`,
  opening a debug port without modifying the Collection App
- Built one-time path-setup UI (browse to exe, save to localStorage)
- Connected from Rust via `tungstenite` WebSocket to `127.0.0.1:9222/json`

**What we learned:**
- Launch + debug-port injection WORKED (green "connected" banner)
- None of the three CDP methods moved the Collection App's video
- Conclusion: the Collection App's video player either isn't a standard HTML5 `<video>`
  element, validates `event.isTrusted`, or the CDP page target was wrong

Reverted CDP entirely back to the working SendInput version.

### Path-resolution sub-issue (during CDP)
- `.lnk` shortcut path failed (shortcuts can't carry env vars)
- Real `.exe` path still failed initially
- Fix attempted: strip quotes/whitespace, set working dir, surface exact received path in error
- Became moot once CDP was abandoned

---

## 7. Current Barriers

1. **Fundamental wall:** Chromium won't re-activate its keyboard listener after a programmatic
   focus return — only a real physical mouse click does. Every out-of-process trick is blocked
   by Chromium's input-trust model.
2. **CDP blocked too:** even injecting directly into the engine didn't drive the Collection
   App's video — suggests the video isn't controllable via standard DOM/keyboard events.
3. **No source access:** can't modify the Collection App (Wails, closed source), so no
   cooperative API/IPC endpoint.

---

## 8. The One Untested Option

**`AttachThreadInput`** — the only cross-process focus technique not yet tried. Temporarily
merges MARK's and the Collection App's input thread queues so Windows treats focus transfer
as legitimate and "deep" (potentially reaching the WebView2 controller).
**Critical risk:** must detach immediately or one app hanging freezes the other.

```rust
let mark_thread = GetWindowThreadProcessId(mark_hwnd, None);
let collection_thread = GetWindowThreadProcessId(collection_hwnd, None);
AttachThreadInput(mark_thread, collection_thread, true);   // merge
SetForegroundWindow(collection_hwnd);
// sleep + SendInput(arrow) ...
SetForegroundWindow(mark_hwnd);
AttachThreadInput(mark_thread, collection_thread, false);  // detach — CRITICAL
```

---

## 9. Current Working Baseline (to revert to if needed)

Commit message: `revert: back to working SendInput sync (works, needs one click) — bump to v1.3.0`

Rust `send_key_to_collection_app(exe_name, key_code)` in `src-tauri/src/main.rs`:
1. EnumWindows partial-title match on `"Tag Once Collection App"` → collection HWND
2. GetForegroundWindow() → save MARK HWND
3. SendInput ALT down+up (unlocks cross-process SetForegroundWindow)
4. SetForegroundWindow(collection), sleep 30ms
5. SendInput arrow key (+ Shift if needed), sleep 30ms
6. SetForegroundWindow(mark)

windows crate 0.61, features: Win32_Foundation, Win32_UI_WindowsAndMessaging,
Win32_UI_Input_KeyboardAndMouse, Win32_System_LibraryLoader.

Key crate gotchas learned:
- BOOL from `windows::core`, not Win32::Foundation
- VK_* from Win32_UI_Input_KeyboardAndMouse, not WindowsAndMessaging
- KBDLLHOOKSTRUCT from Win32_UI_WindowsAndMessaging
- PostMessageA / EnumChildWindows take Option<HWND> (wrap with Some())
- FindWindowA returns Result<HWND> (needs .map_err()?)
- SetWindowsHookExW takes Option<HINSTANCE> (cast HMODULE.0)
- CallNextHookEx takes Option<HHOOK>
- MOUSEINPUT / MOUSEEVENTF_* live in KeyboardAndMouse module

---

## 10. Honest Assessment

The one-click requirement may be the practical ceiling for syncing two independent Chromium
apps without the target app's cooperation. The friction is minor — reviewers click once when
starting, then work normally. v1.3.0 is fully usable.

Realistic paths forward, in order of promise:
1. **AttachThreadInput** — untested, designed for exactly this problem
2. **Ask the Collection App's developers** to add a small CDP-friendly hook or a localhost
   command endpoint — would make CDP work instantly
3. **Accept the one-click** as a known limitation
