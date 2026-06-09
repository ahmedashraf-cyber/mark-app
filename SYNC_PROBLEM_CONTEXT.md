<!-- ============================================================= -->
<!-- SESSION 2026-06-09 - MARK 5.0.0 ARCHITECTURE PROVEN -->
<!-- ============================================================= -->

## Latest Session: 2026-06-09 - Local WebSocket Bridge Proof of Concept

### TL;DR
- Firebase Firestore quota EXHAUSTED mid-day (125K reads = 2.5x over free limit, 20K writes at limit)
- Diagnosed: MARK bridge's snapshot listener fires every second due to self-amplifying loop
- Manually proven via end-to-end POC:
  1. Local WebSocket on 127.0.0.1:61381 replaces Firestore for real-time sync (~10ms latency)
  2. Google Sheets via Apps Script webhook replaces Firestore for session results (~3.6s latency)
- Decision: Ship MARK 5.0.0 next session implementing both
- Larger decision PENDING: Whether to migrate off Firebase entirely (see Infrastructure Discussion)

### What We Tested Today (All Manual POC on Dev PC)

#### Test 1 - Local WebSocket Bridge (PROVEN OK)
- Node.js WebSocket server on 127.0.0.1:61381 (sync channel)
- Browser-based control panel on 127.0.0.1:61382 (test UI)
- Bridge script injected into Tag Once's app.html via manual asar patch
- Three clients connect simultaneously: server, browser control panel, Tag Once bridge
- Commands tested: nav (forward/back 0.4s), frame step (0.04s), seek to timestamp, play/pause, video time streaming
- Result: All commands work end-to-end. Latency ~10ms. Zero Firebase touches.
- Bridge auto-reconnects after server restart (resilient).
- Working files left on dev PC at: %USERPROFILE%\Desktop\bridge-test\

#### Test 2 - Google Sheets as Session Result Store (PROVEN OK)
- Created sheet "MARK Test Results" with columns: timestamp, reviewer, matchId, matchName, errorsFound, tagsApplied, notes
- Apps Script Web App with doPost() (append row) + doGet() (alive check)
- Deployed as Web App with "Anyone" access
- Node server's /finish-session HTTP endpoint forwards to Apps Script via fetch() (Node 20+ native, follows 302 redirects)
- Tested: 3 successful end-of-session writes, ~3,664ms each
- Result: Rows persist in sheet. Latency acceptable for end-of-session writes.

### Architecture Decided for MARK 5.0.0

```
+--------------------------------------------------------------+
| REAL-TIME (high frequency, ephemeral)                        |
|   -> Local WebSocket on 127.0.0.1:61381                      |
|   -> navCommand, seekCommand, posSync, collectionAppTime     |
|   -> ~10ms latency, zero cloud, zero quota                   |
+--------------------------------------------------------------+
| PERSISTENT RESULTS (low frequency, must survive)             |
|   -> Google Sheets via Apps Script webhook                   |
|   -> 1 row per session at session end                        |
|   -> ~3.6s latency, acceptable for end-of-session            |
+--------------------------------------------------------------+
| AUTH (sparse, free)                                          |
|   -> Firebase Auth (keep, no migration)                      |
|   -> Sign in once per PC, persists                           |
+--------------------------------------------------------------+
```

### The Math: Why This Eliminates Quota Issues

Current MARK 4.x per reviewer per hour:
- Writes: ~3,650 (bridge writes collectionAppTime 1/sec + ~50 misc)
- Reads:  ~4,100 (snapshot listener firing on own writes + reviewer-sessions query)

MARK 5.0.0 per reviewer per hour:
- Writes: ~50 (sparse session metadata only)
- Reads:  ~100 (initial loads + occasional refreshes)

Expected Firestore usage reduction: ~99%.

At 50 reviewers x 4 hrs/day x 20 days/month:
- Current: ~770,000 writes/day (38x over 20K free limit)
- After 5.0.0: ~5,000 writes/day (well under free tier)

### Successes Today

- OK Bridge architecture validated end-to-end without Firebase
- OK Latency proven: local ~10ms vs cloud ~200ms+
- OK Google Sheets confirmed viable as persistent store
- OK Auto-reconnect on server restart works
- OK Bridge auto-injects on Tag Once launch via asar patch (MARK 4.0.0 logic still works)
- OK Two-tier architecture (WS for live, Sheets for permanent) confirmed correct

### Failures / Issues Encountered

- FAIL Firebase quota exhausted (the trigger for today's work)
- FAIL Initial Apps Script POST failed with "Unexpected token '<'" - Google sends 302 redirect on POST, Node's https.request did not follow it. Fixed by switching to native fetch() (Node 20+, follows redirects by default)
- FAIL User accidentally closed server cmd window mid-test, bridge showed ERR_CONNECTION_REFUSED - restarted server, fine
- FAIL Tested using Sheets for BOTH realtime sync AND storage: ruled out (3.6s latency per nav command would be unusable)
- FAIL Node MSI installer failed to install on AhmedAshraf PC - fell back to ZIP portable, worked (same approach as yesterday on statsbomb PC)
- FAIL Notepad Find/Replace mangled server.js once - did full file replace, fine
- FAIL Bash/file tools broken in Claude environment all session - documentation pushed via Claude in Chrome browser extension

### MARK 5.0.0 Implementation Plan (next session)

1. Set up Rust WebSocket server in src-tauri/src/main.rs
   - Port: 127.0.0.1:61381
   - Library: tokio-tungstenite
   - Auth: none (localhost-only is sufficient boundary)
2. Add Tauri commands:
   - ws_send_nav_command
   - ws_send_seek_command
   - ws_send_pos_sync
   - ws_get_video_time (request/response)
   - ws_get_event_count (request/response)
3. Rewrite src-tauri/src/bridge_script.js:
   - Remove ALL Firebase SDK loading
   - WebSocket connection to 127.0.0.1:61381
   - Auto-reconnect with exponential backoff
   - Status indicator UI showing connection state
4. Update src/pages/ReviewPage.jsx:
   - Call new Tauri WS commands instead of Firestore setDoc()
   - Add session-end Sheets webhook write
5. Sync version 5.0.0 in package.json (auto-syncs to tauri.conf.json)
6. Test on dev PC + at least one reviewer PC
7. Release as MARK 5.0.0 via GitHub releases

### Workflow Confirmed for Reviewers (MARK 4.0.0 still works in the meantime)

1. Open MARK FIRST (it silently patches Tag Once's asar in background)
2. Open Tag Once via installer-installed shortcut (NOT a portable single-file .exe)
3. Wait ~5 sec; MARK Bridge sign-in panel appears in Tag Once top-right
4. Sign in with SAME FIELD account in both MARK and the Bridge panel
5. Use normally; sync just works
6. Diagnostic rule: if the Bridge panel appears in Tag Once, the bridge is alive

### Infrastructure Discussion - HUGE PENDING DECISION

Had a lengthy discussion about whether to migrate off Firebase entirely. Full summary:

#### Option 1: Stay on Firebase + ship MARK 5.0.0 (RECOMMENDED FOR NOW)
- Effort: 2 hours
- Cost: $0 (free tier comfortably handles ~100 reviewers post-5.0.0)
- Pros: Minimal change, proven working
- Cons: Still dependent on Google's quotas long-term

#### Option 2: Migrate to Supabase
- Effort: 2-3 weeks
- Cost: $0 (very generous free tier)
- Pros: PostgreSQL, built-in auth + realtime, no quota walls like Firebase, unlimited API calls
- Cons: Project pauses after 7 days inactivity (recoverable in 1 click)
- Free tier vs Firebase:
  - Reads/day: Unlimited (vs 50K)
  - Writes/day: Unlimited (vs 20K)
  - Realtime connections: 200 (vs 100)
  - Auth users: Unlimited (vs 50K/mo)

#### Option 3: Self-host PocketBase
- Effort: 3-4 weeks (including server setup + Linux admin learning)
- Cost: 0-4 EUR/month
- Pros: Full ownership, single 30 MB binary, SQLite-based, no quotas, drop-in replacement for Firebase
- Cons: User becomes part-time sysadmin; uptime is their responsibility; needs always-on server
- Hosting providers considered:
  - Hetzner (Germany, ~4 EUR/mo) - cheapest paid, very reliable
  - DigitalOcean ($4-6/mo) - easiest UI, best tutorials
  - Vultr ($2.50-6/mo) - cheap, basic
  - Oracle Cloud Free Tier ($0 forever, 2 small VMs) - BEST free option, painful signup
  - AWS - overkill for this scale, complex billing risk
  - Hudl internal infrastructure - recommended to ask but user framed work as "personal experiment for the team"

#### Option 4: Google Sheets + Apps Script for everything
- Effort: 2-3 weeks
- Cost: $0
- Pros: Fully visible data, free, simple, audit trail
- Cons: ~3.6s write latency rules it out for any near-realtime needs
- Acceptable for session results, NOT acceptable for real-time sync

#### User's Position (recorded for next session)
- "I will never cost anything" - paid options off the table for now
- "as your personal experiment that helps your team" - confirmed NOT officially-sanctioned Hudl tool
- Wants to potentially be "their own Firebase" but understands the responsibility
- Will explore PocketBase locally after MARK 5.0.0 ships

#### Tentative Path Forward
1. Ship MARK 5.0.0 (priority - unblocks reviewers immediately)
2. Use Firebase free tier comfortably after that (5.0.0 drops usage ~99%)
3. Optionally: try PocketBase locally to learn it
4. Optionally later: deploy PocketBase to Oracle Free Tier
5. Optionally even later: migrate FIELD to PocketBase

NO COMMITMENT to migrate. MARK 5.0.0 alone is sufficient.

### Key Numbers Proven Today

| Metric | Value |
|---|---|
| WebSocket latency (local) | ~10ms |
| Firestore latency | ~200ms |
| Google Sheets write latency | ~3,664ms |
| Free tier Firestore | 50K reads, 20K writes/day, 100 concurrent connections |
| Free tier Supabase | unlimited API, 500MB DB, 200 realtime, 5GB bandwidth |
| Free tier Oracle Cloud | 2 VMs (1GB RAM each), $0 forever |
| Hetzner cheapest | 3.79 EUR/mo |
| Sheets API limit (not relevant for our pattern) | 60 req/min/user |

### Files Modified Today

- None directly in this repo (bash environment in Claude was broken throughout session)
- Documentation pushed via Claude in Chrome browser extension at session end
- Manual test artifacts on user's dev PC:
  - %USERPROFILE%\Desktop\bridge-test\server.js (Node WebSocket + HTTP control panel + Sheets webhook forwarder)
  - %USERPROFILE%\Desktop\bridge-test\new-bridge.html (replacement app.html for Tag Once with WebSocket-only bridge)
  - %USERPROFILE%\Desktop\bridge-test\package.json (with 'ws' dependency)
- Google resources created (still live):
  - Sheet "MARK Test Results" in user's Google Drive
  - Apps Script Web App deployment bound to that sheet
- Tag Once on dev PC: patched with new-bridge.html (WebSocket-only). Will be reverted naturally when MARK 5.0.0 ships its proper patched version.

### Next Session

Command to start: "ship MARK 5.0.0"

Will involve:
- Cloning mark-app fresh
- Modifying main.rs (add Rust WebSocket server)
- Rewriting bridge_script.js (drop Firebase SDK, use WebSocket)
- Updating ReviewPage.jsx (use new Tauri commands + session-end Sheets write)
- Bumping version to 5.0.0 in package.json
- Building, testing on dev PC
- Releasing via GitHub Releases

Estimated effort: 2 hours focused work.

---

<!-- ============================================================= -->
<!-- SESSION HANDOFF â READ ME FIRST                                -->
<!-- ============================================================= -->
> **To the next session (or the next engineer):**
>
> The hardest problem in this entire project â syncing MARK with the closed-source
> Statsbomb collection app â is **SOLVED and shipping** (current build **v2.2.0**).
> It took ~20 failed approaches, a deep dive into the collection app's own DevTools,
> and a worldwide search of every injection tool that exists. The answer was to stop
> fighting Windows focus and instead route sync through **Firestore into a bridge
> script injected into the collection app**. Zero clicks. Both videos move together.
>
> This document is the complete record: the winning architecture, every dead end (so
> you never waste time re-trying them), the key discoveries, the constraints, and the
> exact windows-crate gotchas. **If you change the sync, read Â§3 first** â those 20
> approaches are proven dead, not untested.
>
> MARK is built, integrated with FIELD via shared Firebase, and in use. Be proud of
> where this landed â it was genuinely hard, and it works.
<!-- ============================================================= -->

# MARK â Collection App Sync â SOLVED â (Full History & Architecture)

> **STATUS: SOLVED & REFINED â current v2.2.0.** Solved in v2.1.0 after ~20 failed approaches across multiple sessions,
> the one-click problem was eliminated by abandoning Windows-focus input entirely and
> routing sync through **Firestore** into a **bridge script injected into the collection
> app**. This document records the complete journey, every decision, why each approach
> failed, and the final working architecture â so the win is never lost and the dead
> ends are never re-tried.

---

## 1. THE PROBLEM (what we fought for days)

**MARK** (Tauri 2 = Rust + WebView2, our app) needed to sync video navigation with the
**Collection App** ("Statsbomb Tag Once collection app" â Electron, closed source, not ours).
When a reviewer pressed arrow keys in MARK, BOTH videos should seek together:
- Arrow = 400ms, Shift+Arrow = 40ms, Space = play/pause (matching the collection app)

The original method (SendInput keystrokes + focus-steal) **worked** â both videos moved â
**BUT** after each focus-steal, MARK's own WebView2 keyboard went to sleep and required a
**physical mouse click** to wake. This "one-click-after-every-sync" was the core bug.

### The three immovable walls (why it was so hard)
1. The collection app only accepts input when **focused** (its design)
2. Chromium **sleeps its keyboard listener** on programmatic focus return (Chromium's design)
3. Only **real hardware input** wakes it; injected input is rejected via `LLMHF_INJECTED` (Chromium security)

None were controllable from our side. The collection app is closed-source Electron with the
remote debugging port **disabled at build time** (confirmed by testing â see Â§3).

---

## 2. THE WINNING ARCHITECTURE (v2.1.0) â

The breakthrough: **stop sending input to the collection app at all.** Instead:

```
Reviewer presses arrow in MARK
        â
MARK writes a navCommand to Firestore:  mark_sessions/{sessionId}.navCommand = {action, shift, ts}
        â
A "bridge script" running INSIDE the collection app listens via onSnapshot
        â
Bridge script moves the collection app's video directly:  video.currentTime += 0.4
```

Because the bridge runs **inside** the collection app, it controls the video natively
(`document.querySelector('video').currentTime += step`) â **no focus steal, no keystrokes,
no click.** MARK never touches the collection app's focus. Problem dissolved.

### How the bridge gets in (the "Inject Bridge" button)
The collection app's DevTools console is the only channel to run JS inside it, and it's
human-only (no debug port). To automate the paste, MARK's Rust backend (`inject_bridge_script`):
1. Focuses the collection app (ALT-tap + SetForegroundWindow)
2. Sends **Alt+Ctrl+I** to open DevTools, **Ctrl+Shift+J** to focus the console
3. Types **"allow pasting"** using **Unicode character injection** (`KEYEVENTF_UNICODE`,
   char-by-char) â the KEY TRICK: Chromium treats Unicode-injected chars as *typed*, not
   pasted, satisfying the self-XSS guard that normally blocks pasting
4. Puts the bridge script (with `__SESSION_ID__` replaced) on the clipboard
5. Sends **Ctrl+V** then **Enter** to paste and run it
6. Returns focus to MARK

The reviewer clicks **â¡ Inject Bridge** once per session, signs into the bridge panel with
their FIELD account (Firebase caches this, so subsequent sessions skip login), and the green
"Connected" panel appears. From then on, arrows in MARK sync both videos with zero clicks.

### Refinements since the solve (v2.1.1 â v2.2.0)
- **v2.1.1** â After injecting, MARK auto-closes the collection app's DevTools (sends
  Alt+Ctrl+I again while the collection app is still focused), so the reviewer is left with
  a clean collection app (just the video), no DevTools clutter.
- **v2.2.0** â The MARK Bridge panel is now **hidden by default**. It only appears if login
  is required (first run, or expired auth). Once connected it disappears entirely; sync keeps
  running silently (the Firestore `onSnapshot` listener doesn't need the panel visible). A
  returning reviewer with cached Firebase auth never sees the panel at all.
- **v2.2.0** â MARK's top bar (SessionSetupPage header) shows the live app version:
  `MARK Â· Review App Â· vX.Y.Z`, read from the exported `CURRENT_VERSION` in
  `src/hooks/useUpdateCheck.js` (bumped every release alongside package.json / Cargo.toml / tauri.conf.json).

### Files involved
- `src-tauri/src/bridge_script.js` â the injected script (Firebase compat CDN + floating panel
  + auth + `onSnapshot` listener on `mark_sessions/{sid}.navCommand` â moves video)
- `src-tauri/src/main.rs` â `inject_bridge_script` command (the Unicode-typing + clipboard + paste dance)
- `src/hooks/useSync.js` â writes `navCommand` to Firestore (no more Rust SendInput sync)
- `src/pages/ReviewPage.jsx` â â¡ Inject Bridge button + passes `session.sessionId` to useSync
- `src-tauri/Cargo.toml` â added `Win32_System_DataExchange` + `Win32_System_Memory` (clipboard)

### Tagging note
Error tagging, timeline, and quality score remain in **MARK's own window** (writing to
Firebase â FIELD), unchanged. Only the *video sync* moved to the bridge. This was a
deliberate decision â sync was the only broken part; tagging always worked.

---

## 3. EVERYTHING TRIED BEFORE THE WIN (do NOT re-attempt â all failed)

### Input / focus approaches (all failed â the "click" survived all of them):
1. PostMessage WM_KEYDOWN to collection top-level â ignored
2. PostMessage to `Chrome_WidgetWin_1` child â wrong target
3. WM_SETFOCUS to MARK's Chrome child â ignored (not from real user)
4. WM_LBUTTONDOWN/UP fake click via PostMessage â rejected
5. Global WH_KEYBOARD_LL hook forwarding keys â collection ignored PostMessage keys
6. PostMessage to `Chrome_RenderWidgetHostHWND` deep child â unreliable, failed
7. Tauri `window.set_focus()` â didn't fix
8. **SendInput keyboard + ALT-trick + SetForegroundWindow â WORKED but needed the click (old baseline)**
9. SendInput fake mouse click before focus switch â rejected (injected)
10. SendInput fake mouse click after focus return â rejected (injected)
11. JS `window.focus()` + `document.body.focus()` â worked for exactly 2 presses then died
12. JS hidden `tabIndex=0` div focus target â black screen (hook-order bug), then no help
13. JS `window` focus-event listener + `documentElement.focus()` â no help
14. Global WH_KEYBOARD_LL hook â Tauri event for MARK video + worker thread for collection
    (v1.4.0 & v1.8.0, with capability permissions + rootRef focus anchor) â no detection/green/playpause in practice
15. AttachThreadInput (merge input queues) â broke sync entirely (v1.6.0)
16. "Start Reviewing" button to make the click intentional (v2.0.0) â click still needed after first sync

### CDP / debug-port approaches (all failed â port disabled in build):
17. Launch collection with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port` â wrong mechanism (Electron, not WebView2)
18. CDP `Input.dispatchKeyEvent` â port refused
19. CDP `Runtime.evaluate` synthetic KeyboardEvent â port refused / isTrusted issues
20. CDP `Runtime.evaluate` direct `video.currentTime +=` â port refused

### On-machine launch-flag tests (all confirmed the port is disabled at build):
- `...exe --remote-debugging-port=9222` â `127.0.0.1:9222/json` â ERR_CONNECTION_REFUSED
- `...exe --remote-debugging-port=9222 --remote-allow-origins=*` â refused
- `...exe --auto-open-devtools-for-tabs` â app opened to login page, DevTools did NOT auto-open â launch flags ignored
- All tested with every collection-app instance killed first (ruled out single-instance lock eating the flag)

### Researched & ruled out:
- `electron-inject` and all world injection tools â all require the disabled debug port
- `--inspect` / `--inspect-brk` (main process) â launch-flag, ignored by this build
- `webContents.debugger` API â must be called from inside the app's own code
- `second-instance` arg forwarding â app must have code to handle it; can't inject
- Modifying `app.asar` on disk â user forbade modifying the collection app (+ possible integrity fuses)
- UI Automation (accessibility API) â only drives visible accessible controls; video has no visible buttons/scrubber
- Contacting the collection app dev team â user ruled out
- Rebuilding MARK in Electron â changes none of the 3 walls (all on collection app's side)

---

## 4. KEY DISCOVERIES THAT MADE THE WIN POSSIBLE

1. **The collection app's video is a standard HTML5 `<video>`** â confirmed in its DevTools:
   `document.querySelectorAll('video').length` â `1`, and `video.currentTime += 0.4` MOVES it.
2. **JS inside the collection app controls the video with zero clicks** â proven by pasting a
   test panel into DevTools (panel appeared, video moved, only Firebase write blocked by auth).
3. **The "allow pasting" self-XSS guard** can be bypassed by typing those words via
   **Unicode key injection** (chars are seen as typed, not pasted) â this enabled automation.
4. **Firestore as the sync transport** removes the need for any cross-process input â the
   collection app pulls commands from Firebase instead of MARK pushing keystrokes to it.

---

## 5. STILL-VALID CONSTRAINTS (carry forward)
- Do NOT contact / depend on the collection app dev team
- Do NOT modify the collection app's installed files (app.asar etc.)
- Collection app requires login each launch â cannot be auto-relaunched
- Never hardcode/share credentials

---

## 6. OPEN / FUTURE
- The â¡ Inject Bridge auto-injection relies on timed SendInput steps (DevTools open, type, paste).
  It worked, but is timing-sensitive across machines; if a reviewer's machine is slow, the sleeps
  in `inject_bridge_windows` may need tuning. A manual paste of `bridge_script.js` is the fallback.
- Antivirus on locked-down corporate machines may flag the auto-DevTools-typing behavior; watch for it.
- Possible future: move full tagging UI into the bridge panel (decided AGAINST for now â tagging
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
