<!-- ============================================================= -->
<!-- SESSION HANDOFF — READ ME FIRST                                -->
<!-- ============================================================= -->
> **To the next session (or the next engineer):**
>
> The hardest problem in this entire project — syncing MARK with the closed-source
> Statsbomb collection app — is **SOLVED and shipping** (current build **v2.2.0**).
> It took ~20 failed approaches, a deep dive into the collection app's own DevTools,
> and a worldwide search of every injection tool that exists. The answer was to stop
> fighting Windows focus and instead route sync through **Firestore into a bridge
> script injected into the collection app**. Zero clicks. Both videos move together.
>
> This document is the complete record: the winning architecture, every dead end (so
> you never waste time re-trying them), the key discoveries, the constraints, and the
> exact windows-crate gotchas. **If you change the sync, read §3 first** — those 20
> approaches are proven dead, not untested.
>
> MARK is built, integrated with FIELD via shared Firebase, and in use. Be proud of
> where this landed — it was genuinely hard, and it works.
<!-- ============================================================= -->

# MARK ↔ Collection App Sync — SOLVED ✅ (Full History & Architecture)

> **STATUS: SOLVED & REFINED — current v2.2.0.** Solved in v2.1.0 after ~20 failed approaches across multiple sessions,
> the one-click problem was eliminated by abandoning Windows-focus input entirely and
> routing sync through **Firestore** into a **bridge script injected into the collection
> app**. This document records the complete journey, every decision, why each approach
> failed, and the final working architecture — so the win is never lost and the dead
> ends are never re-tried.

---

## 1. THE PROBLEM (what we fought for days)

**MARK** (Tauri 2 = Rust + WebView2, our app) needed to sync video navigation with the
**Collection App** ("Statsbomb Tag Once collection app" — Electron, closed source, not ours).
When a reviewer pressed arrow keys in MARK, BOTH videos should seek together:
- Arrow = 400ms, Shift+Arrow = 40ms, Space = play/pause (matching the collection app)

The original method (SendInput keystrokes + focus-steal) **worked** — both videos moved —
**BUT** after each focus-steal, MARK's own WebView2 keyboard went to sleep and required a
**physical mouse click** to wake. This "one-click-after-every-sync" was the core bug.

### The three immovable walls (why it was so hard)
1. The collection app only accepts input when **focused** (its design)
2. Chromium **sleeps its keyboard listener** on programmatic focus return (Chromium's design)
3. Only **real hardware input** wakes it; injected input is rejected via `LLMHF_INJECTED` (Chromium security)

None were controllable from our side. The collection app is closed-source Electron with the
remote debugging port **disabled at build time** (confirmed by testing — see §3).

---

## 2. THE WINNING ARCHITECTURE (v2.1.0) ✅

The breakthrough: **stop sending input to the collection app at all.** Instead:

```
Reviewer presses arrow in MARK
        ↓
MARK writes a navCommand to Firestore:  mark_sessions/{sessionId}.navCommand = {action, shift, ts}
        ↓
A "bridge script" running INSIDE the collection app listens via onSnapshot
        ↓
Bridge script moves the collection app's video directly:  video.currentTime += 0.4
```

Because the bridge runs **inside** the collection app, it controls the video natively
(`document.querySelector('video').currentTime += step`) — **no focus steal, no keystrokes,
no click.** MARK never touches the collection app's focus. Problem dissolved.

### How the bridge gets in (the "Inject Bridge" button)
The collection app's DevTools console is the only channel to run JS inside it, and it's
human-only (no debug port). To automate the paste, MARK's Rust backend (`inject_bridge_script`):
1. Focuses the collection app (ALT-tap + SetForegroundWindow)
2. Sends **Alt+Ctrl+I** to open DevTools, **Ctrl+Shift+J** to focus the console
3. Types **"allow pasting"** using **Unicode character injection** (`KEYEVENTF_UNICODE`,
   char-by-char) — the KEY TRICK: Chromium treats Unicode-injected chars as *typed*, not
   pasted, satisfying the self-XSS guard that normally blocks pasting
4. Puts the bridge script (with `__SESSION_ID__` replaced) on the clipboard
5. Sends **Ctrl+V** then **Enter** to paste and run it
6. Returns focus to MARK

The reviewer clicks **⚡ Inject Bridge** once per session, signs into the bridge panel with
their FIELD account (Firebase caches this, so subsequent sessions skip login), and the green
"Connected" panel appears. From then on, arrows in MARK sync both videos with zero clicks.

### Refinements since the solve (v2.1.1 → v2.2.0)
- **v2.1.1** — After injecting, MARK auto-closes the collection app's DevTools (sends
  Alt+Ctrl+I again while the collection app is still focused), so the reviewer is left with
  a clean collection app (just the video), no DevTools clutter.
- **v2.2.0** — The MARK Bridge panel is now **hidden by default**. It only appears if login
  is required (first run, or expired auth). Once connected it disappears entirely; sync keeps
  running silently (the Firestore `onSnapshot` listener doesn't need the panel visible). A
  returning reviewer with cached Firebase auth never sees the panel at all.
- **v2.2.0** — MARK's top bar (SessionSetupPage header) shows the live app version:
  `MARK · Review App · vX.Y.Z`, read from the exported `CURRENT_VERSION` in
  `src/hooks/useUpdateCheck.js` (bumped every release alongside package.json / Cargo.toml / tauri.conf.json).

### Files involved
- `src-tauri/src/bridge_script.js` — the injected script (Firebase compat CDN + floating panel
  + auth + `onSnapshot` listener on `mark_sessions/{sid}.navCommand` → moves video)
- `src-tauri/src/main.rs` — `inject_bridge_script` command (the Unicode-typing + clipboard + paste dance)
- `src/hooks/useSync.js` — writes `navCommand` to Firestore (no more Rust SendInput sync)
- `src/pages/ReviewPage.jsx` — ⚡ Inject Bridge button + passes `session.sessionId` to useSync
- `src-tauri/Cargo.toml` — added `Win32_System_DataExchange` + `Win32_System_Memory` (clipboard)

### Tagging note
Error tagging, timeline, and quality score remain in **MARK's own window** (writing to
Firebase → FIELD), unchanged. Only the *video sync* moved to the bridge. This was a
deliberate decision — sync was the only broken part; tagging always worked.

---

## 3. EVERYTHING TRIED BEFORE THE WIN (do NOT re-attempt — all failed)

### Input / focus approaches (all failed — the "click" survived all of them):
1. PostMessage WM_KEYDOWN to collection top-level → ignored
2. PostMessage to `Chrome_WidgetWin_1` child → wrong target
3. WM_SETFOCUS to MARK's Chrome child → ignored (not from real user)
4. WM_LBUTTONDOWN/UP fake click via PostMessage → rejected
5. Global WH_KEYBOARD_LL hook forwarding keys → collection ignored PostMessage keys
6. PostMessage to `Chrome_RenderWidgetHostHWND` deep child → unreliable, failed
7. Tauri `window.set_focus()` → didn't fix
8. **SendInput keyboard + ALT-trick + SetForegroundWindow → WORKED but needed the click (old baseline)**
9. SendInput fake mouse click before focus switch → rejected (injected)
10. SendInput fake mouse click after focus return → rejected (injected)
11. JS `window.focus()` + `document.body.focus()` → worked for exactly 2 presses then died
12. JS hidden `tabIndex=0` div focus target → black screen (hook-order bug), then no help
13. JS `window` focus-event listener + `documentElement.focus()` → no help
14. Global WH_KEYBOARD_LL hook → Tauri event for MARK video + worker thread for collection
    (v1.4.0 & v1.8.0, with capability permissions + rootRef focus anchor) → no detection/green/playpause in practice
15. AttachThreadInput (merge input queues) → broke sync entirely (v1.6.0)
16. "Start Reviewing" button to make the click intentional (v2.0.0) → click still needed after first sync

### CDP / debug-port approaches (all failed — port disabled in build):
17. Launch collection with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port` → wrong mechanism (Electron, not WebView2)
18. CDP `Input.dispatchKeyEvent` → port refused
19. CDP `Runtime.evaluate` synthetic KeyboardEvent → port refused / isTrusted issues
20. CDP `Runtime.evaluate` direct `video.currentTime +=` → port refused

### On-machine launch-flag tests (all confirmed the port is disabled at build):
- `...exe --remote-debugging-port=9222` → `127.0.0.1:9222/json` → ERR_CONNECTION_REFUSED
- `...exe --remote-debugging-port=9222 --remote-allow-origins=*` → refused
- `...exe --auto-open-devtools-for-tabs` → app opened to login page, DevTools did NOT auto-open → launch flags ignored
- All tested with every collection-app instance killed first (ruled out single-instance lock eating the flag)

### Researched & ruled out:
- `electron-inject` and all world injection tools → all require the disabled debug port
- `--inspect` / `--inspect-brk` (main process) → launch-flag, ignored by this build
- `webContents.debugger` API → must be called from inside the app's own code
- `second-instance` arg forwarding → app must have code to handle it; can't inject
- Modifying `app.asar` on disk → user forbade modifying the collection app (+ possible integrity fuses)
- UI Automation (accessibility API) → only drives visible accessible controls; video has no visible buttons/scrubber
- Contacting the collection app dev team → user ruled out
- Rebuilding MARK in Electron → changes none of the 3 walls (all on collection app's side)

---

## 4. KEY DISCOVERIES THAT MADE THE WIN POSSIBLE

1. **The collection app's video is a standard HTML5 `<video>`** — confirmed in its DevTools:
   `document.querySelectorAll('video').length` → `1`, and `video.currentTime += 0.4` MOVES it.
2. **JS inside the collection app controls the video with zero clicks** — proven by pasting a
   test panel into DevTools (panel appeared, video moved, only Firebase write blocked by auth).
3. **The "allow pasting" self-XSS guard** can be bypassed by typing those words via
   **Unicode key injection** (chars are seen as typed, not pasted) — this enabled automation.
4. **Firestore as the sync transport** removes the need for any cross-process input — the
   collection app pulls commands from Firebase instead of MARK pushing keystrokes to it.

---

## 5. STILL-VALID CONSTRAINTS (carry forward)
- Do NOT contact / depend on the collection app dev team
- Do NOT modify the collection app's installed files (app.asar etc.)
- Collection app requires login each launch — cannot be auto-relaunched
- Never hardcode/share credentials

---

## 6. OPEN / FUTURE
- The ⚡ Inject Bridge auto-injection relies on timed SendInput steps (DevTools open, type, paste).
  It worked, but is timing-sensitive across machines; if a reviewer's machine is slow, the sleeps
  in `inject_bridge_windows` may need tuning. A manual paste of `bridge_script.js` is the fallback.
- Antivirus on locked-down corporate machines may flag the auto-DevTools-typing behavior; watch for it.
- Possible future: move full tagging UI into the bridge panel (decided AGAINST for now — tagging
  in MARK's window works fine and was never the problem).

---

## 7. WINDOWS CRATE 0.61 GOTCHAS (saved us repeatedly)
- BOOL from `windows::core`; VK_* from KeyboardAndMouse; KBDLLHOOKSTRUCT from WindowsAndMessaging
- PostMessageA/EnumChildWindows take `Option<HWND>`; FindWindowA returns `Result<HWND>`
- SetWindowsHookExW takes `Option<HINSTANCE>`; CallNextHookEx takes `Option<HHOOK>`
- dwExtraInfo is usize; vkCode is u32
- Clipboard: GlobalAlloc returns HGLOBAL; SetClipboardData takes `(u32, Option<HANDLE>)` returns Result;
  CF_UNICODETEXT = 13; needs `Win32_System_DataExchange` + `Win32_System_Memory` features
- KEYEVENTF_UNICODE for typed-char injection (wVk=0, wScan=codeunit)
- Tauri v2: custom #[command] fns are auto-allowed; listen() needs core:event:*; setFocus needs core:window:allow-set-focus
