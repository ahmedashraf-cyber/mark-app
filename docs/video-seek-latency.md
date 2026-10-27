# Tag-mode video seek latency: root cause and fix

| | |
|---|---|
| Status | Fixed for **Tag mode only**. Verified on a Windows machine with test build 7.12.23. Not yet released. |
| Scope | `src-tauri/src/main.rs` (video server), `src-tauri/src/video_range.rs` (new), `src/utils/videoSrc.js` (new), `src/pages/FieldPage.jsx`, `src/components/PerfOverlay.jsx` |
| Code references | Line numbers in section 2 refer to the shipped v7.12.21 (`722cedc`); section 4 to this branch. |

## 1. Symptom

In Tag mode, seeking to a position the player had not already buffered took 350 to 1700 ms, while seeks inside the buffer took about 10 ms. Dropped frames were 0, long tasks were 0 and React renders were 3 to 12 per second, so the UI thread and the decoder were not the problem. In DevTools, tiny requests (about 316 B) showed 415 to 710 ms, but a 2 MB request only 24 ms, which looked like a fixed per-request overhead of about 450 ms.

It is **not** a fixed overhead. The cost depends on how much of the file is *left* after the seek position.

## 2. Root cause

### 2.1 What the player asks for

The `<video>` element (WebView2/Chromium) requests media with open-ended ranges: `Range: bytes=N-`, meaning "from N to the end of the file". In the trace below **all 40 of 40** requests were open-ended. A seek outside the buffered range makes the player abort its current request and send a new `bytes=N-` for the target position. Every request is open-ended; a file read is only as long as the bytes after N.

### 2.2 What `serve_video` did with it

`serve_video` (`main.rs:56-146`, v7.12.21), for every request:

1. `std::fs::File::open(&path)` and `file.metadata()` every time (`:76`, `:83`).
2. `HttpRange::parse` turns `bytes=N-` into `length = file_size - N`.
3. `let mut buf = vec![0u8; length as usize]` then `file.seek(..)` and `file.read_exact(&mut buf)` (`:107-109`). The **entire requested range is read into memory before the first byte is sent.** For an open-ended range that is the rest of the file: up to about 800 MB per request.
4. Fallbacks (`:129-130`): no `Range` header, `HEAD`, an invalid range or an unsatisfiable range (for example `bytes=<file size>-`) all fell through to `vec![0u8; file_size]` plus a full read, and answered **206 with the whole file**.

### 2.3 Why that blocks, and why aborts did not help

* The handler contains **zero `.await`**: all five of its file calls are blocking `std` calls (`:76`, `:83`, `:108`, `:109`, `:130`). It does its entire job in a single poll, on a tokio worker thread. The server runs on `tokio::runtime::Runtime::new()` (`:2130`), a multi-thread runtime with one worker per core, which also hosts the WebSocket sync server (`:2135`).
* Because there is never a suspension point, **hyper cannot cancel it**. When a seek makes the player drop the old request, the handler still finishes reading the whole range. The DevTools screenshot shows it: the browser received **624 B** of a request for which the server logged `len=781854480` bytes read in 309 ms.
* A big read ties up a worker thread (and the disk) for its duration. On a machine with few cores, or with several such reads in flight, a small request has to wait for a free worker. We reproduced that on a 1-core Linux box: a 316 B request that arrived during a big read waited about 490 to 670 ms while its own handler time was 0.02 ms. **This did not turn out to be the main cause on the affected machine** (see 2.4: handlers never overlapped there). It is a real design defect and the second-order reason the old path scaled badly, but the first-order cost was the read itself.

### 2.4 Evidence from a real trace

The 7.12.22 diagnostic build added opt-in per-request timing (`Server-Timing`, `X-MARK-Trace`, `%TEMP%\mark-video-trace.log`). One user session gave 40 requests:

| Measurement | Value |
|---|---|
| Requests that were open-ended (`bytes=N-`) | 40 of 40 |
| Requests that read more than 100 MB into RAM | 37 of 40 (median 782 MB, max 814 MB) |
| Handler time, those requests | median **309 ms** (min 274, max 748) |
| Share of handler time spent in `read_exact` | about 99% on the large requests |
| `open` / `stat` / `seek` (max) | 0.27 / 0.04 / 0.00 ms |
| `alloc` (max) | 0.09 ms (zeroed allocation is lazy; the cost lands in `read`) |
| Overlapping handlers (`concurrent`, max) | **1** |
| The two roughly 2 MB tail requests | 0.81 and 0.88 ms |
| First request after opening a file (cold file cache) | 748 ms, vs about 307 ms warm |

Conclusions:

* The cost is **proportional to the bytes after the seek position**, at about 2.5 GB/s: about 300 ms for 780 MB, under 1 ms for 2 MB. It is not constant. A seek near the start of a file is the worst case.
* `open`, `stat` and `seek` are negligible, so file-open cost and antivirus-on-open are **ruled out**.
* `concurrent` never exceeded 1, so queueing behind other requests was **not** the main cause on this machine.
* Slow seeks of 1193 ms and 1707 ms are consistent with 3 to 4 dependent requests in sequence (each about 300 ms plus overhead). The trace shows bursts of 17 requests in 12 s. This is an inference, not a direct measurement.
* **Unexplained:** the browser showed 572 ms for the first request while the handler accounts for 309 ms. The remaining roughly 260 ms is not in the handler. After the fix the end-to-end numbers were small (section 5), so it did not need explaining, but we have not identified it.

### 2.5 Related defects found along the way

* **End-of-file probes.** 13 requests for exactly `bytes=781854480-` (the file size) were each answered with the whole 782 MB file: 10.2 GB copied in about 4 s of reading, repeating every about 1.2 s. The correct answer is `416 Range Not Satisfiable`. The player kept retrying because it got a wrong answer.
* **`HEAD` read the whole file** (739 ms in our reproduction) and threw the body away.
* **Invalid or reversed ranges** (`bytes=10-5`, `garbage`) returned the whole file.

## 3. The fix

### 3.1 What changed

New code path in the same server, selected per request with **`?chunked=1`**:

* `video_range.rs` (new, pure, unit-tested) decides which bytes one response carries. `CHUNK_BYTES = 4 MiB`. An open-ended or oversized range is **capped at 4 MiB**. This is legal HTTP: a server may answer a range request with less than was asked, as long as `Content-Range` states what it sent; the player simply asks for the next piece when it needs it. A request with no `Range` header gets the first chunk with the total size in `Content-Range`. An unsatisfiable request (past or exactly at end-of-file, reversed, garbage, empty file) is `Unsatisfiable`.
* `serve_chunked` (`main.rs:273`) uses **`tokio::fs`** (`File::open`, `metadata`, `seek`, `read_exact`, all `.await`ed), so no worker thread is blocked on disk. It reads at most 4 MiB into a bounded buffer, sends `206` with a truthful `Content-Range`, `Content-Length`, `Accept-Ranges` and the same CORS headers as before.
* **`HEAD`** returns the headers without reading anything.
* **Unsatisfiable ranges** return `416` with `Content-Range: bytes */<size>`.

What it does *not* do: it is not a streaming body. It reads one bounded chunk and sends it. There is also no explicit cancel-on-disconnect. Instead, the work per request is bounded, so an aborted request costs at most one 4 MiB read (about 2 ms) instead of up to 800 MB. If a streaming body is ever wanted, dropping the stream on disconnect would give real cancellation.

### 3.2 How it is gated (Tag mode only)

* `serve_video` falls straight through to its **original code, unchanged**, unless the query string contains `chunked` (`main.rs:163`).
* `src/utils/videoSrc.js` builds the URL: `?chunked=1` by default, plus `&trace=1` when the perf overlay is on. **Only `FieldPage.jsx` calls it** (`:435`). Every other screen builds its URL from `get_video_url` directly and therefore stays on the original path.
* Escape hatch: `localStorage.mark_video_legacy = '1'` gives Tag mode the original URL exactly (for A/B comparison or rollback without a new installer). Remove it to return to the new behaviour.

### 3.3 Observability that stays in

* `?trace=1` (added automatically when `localStorage.mark_perf = '1'`): per-request `Server-Timing: open, stat, alloc, seek, read, build, total`, an `X-MARK-Trace` header (range asked, open-ended or not, bytes served, concurrent handlers, outcome) and one log line per request in `%TEMP%\mark-video-trace.log`. Off by default; when off none of it runs. The log file is append-only and not rotated, so it grows while the overlay is on.
* The perf overlay now counts, per second: seeks, overlapping seeks, seeks while playing, slow seeks (over 200 ms) and decoder stalls, and keeps the last 12 seeks (target, playing, duration) in the JSON copy. Existing fields are unchanged.

## 4. Results

### 4.1 Before (real machine, perf overlay)

| Recording | Seeks | Slow (>200 ms) | Median | Max | Overlapping | Dropped frames | Long tasks |
|---|---|---|---|---|---|---|---|
| Playing + seeking (first file) | 12 seeks | 6 (350 to 1469 ms) | 15.2 ms | **1469.2 ms** | n/a (not counted yet) | 0 | 0 |
| Paused stepping (second file) | 21 | 10 (354 to 1707 ms) | fast ones 10.6 ms | 1707 ms | **0** | 0 | 0 |

### 4.2 After (real machine, test build 7.12.23)

As reported by the person who tested it (the raw overlay JSON is not attached to this document; **attach it here**): seek **max 39 ms** (was 1469 ms), **median 7 ms** (was 15 ms), **0 slow seeks, 0 overlapping seeks**.

### 4.3 Controlled comparison (the real handler code run as a standalone server)

Linux, 800 MB file, 2 worker threads, a player-like client (open-ended request, read the first 64 KB, drop the connection), 24 seeks to random positions. Absolute numbers depend on the machine; the ratio is the point.

| | Original path | Chunked path |
|---|---|---|
| First byte after a seek, median | 311 ms | 1.7 ms |
| First byte after a seek, p95 / worst | 563 / 847 ms | 3.3 / 3.9 ms |
| The 13 end-of-file probes from the trace | 6,046 ms total | 3 ms total |
| Server memory growth | +823 MB | +16 MB |
| Small request during a big open-ended one | 37 ms | 0.4 ms |
| Small request just after a client abort | 50 ms | 0.4 ms |

## 5. Tests and checks

**Automated**

* `video_range.rs`: 13 unit tests, using the real values from the trace (the 316 B request, `bytes=6356992-` that made the server read 807,968,153 bytes, the roughly 2 MB tail request, and `bytes=<file size>-`). They ran in a standalone crate; once a `cargo test` step exists in CI they will run there too.
* Original path unchanged: the previous and new server were run side by side on **13 request shapes** (no Range, `HEAD`, 1 byte, 316 B, 2 MB, open-ended, suffix, multi-range, reversed, garbage, unsatisfiable, past EOF); status, every header and the body hash were identical: 13/13.
* Chunked path correct: responses compared to the file's bytes (316 B, the 4 MiB cap, the 2 MB tail, suffix, multi-range, no-Range, `HEAD`, 416 cases), and walking 120 MB chunk by chunk, as a player does, reproduced the file exactly.
* Tag mode in the real page (jsdom, fake Firestore and Tauri): the four URL switch combinations (default, overlay on, legacy, legacy + overlay); exact overlay counters (3 seeks, 1 overlapping, 3 while playing, 1 slow, 1 stall); existing Tag-mode suites 83/83 and 51/51 still pass.

**Windows**

* The Windows CI build of the code succeeded for 7.12.23, which proves the new Rust compiles in the real Tauri crate.
* 7.12.23 was installed and run on a Windows machine and **works** (see 4.2).
* Recorded smoke checklist (tick when confirmed):
  - [ ] seeking forward and backward while playing and while paused
  - [ ] dragging the progress bar
  - [ ] 10+ minutes of continuous playback with no stalls (`waitingPerSec` stays 0)
  - [ ] a second video opened in the same session
  - [ ] `mark_video_legacy = '1'` switches back and the old behaviour returns
  - [ ] Scout, Audit, History, Insights, Self-Review, Comparison and Drill still play video (they were not changed)

## 6. Risks and what is not covered

* **Other screens are still on the original path** and still have the problem. Call sites that use `get_video_url` and set the element's source directly: `ReviewPage.jsx` (`:246`, `:613`), `AuditPage.jsx` (`:2198`), `SessionHistoryPage.jsx` (`:466`, `:485`), `ComparisonPage.jsx` (`:326`, `:531`), `CollectorSelfReviewPage.jsx` (`:342`), `InsightsPage.jsx` (`:600` and its `VideoPanel` at `:351`), and the pop-out `VideoWindow` / `VideoPanel`.
* **Drill** gets its clips from a different handler, the Google Drive proxy (`serve_drive`), which was **not analysed** and may or may not have the same defect.
* **Codec and hardware decoding were not investigated beyond `ffprobe`.** The test video is H.264 Main, 1280x720, 30 fps, which is cheap to decode, and dropped frames were 0 throughout. Whether WebView2 uses hardware decoding was **not checked**. Keyframe interval was **not measured**.
* **WebView2 behaviour with shorter-than-requested `206` responses** is standard HTTP and worked in the test, but only one machine and one file type was exercised. Other containers (`mkv`, `mov`, `avi`, `mts`) and unusually large files are untested.
* **Chunk size (4 MiB) was chosen, not tuned.** Smaller means more requests; larger means a longer first byte on a slow disk. A cold read from a slow or network disk was not measured.
* **Memory:** each in-flight chunked request holds up to 4 MiB; the original held up to the file size.
* The original path keeps all the defects in 2.5 and 2.3 until it is replaced.
* The trace log has no size limit while the overlay is on.

## 7. Suggested rollout to the other screens

Goal: remove the original read-the-rest-of-the-file behaviour everywhere, with an easy rollback at each step.

1. **Safe global fixes first, no behaviour change for working requests.** In the original path only: answer `HEAD` without reading, and answer unsatisfiable ranges (`bytes=<size>-`, reversed, garbage) with `416`. These only change responses the player should never have been getting. Verify with the 13-shape comparison (the three unsatisfiable shapes will now differ on purpose).
2. **Scout review (`ReviewPage`)** next, since it is the core review screen: call `videoSrcFor(url)` at `:246` and `:613`, measure old vs new with `mark_video_legacy`, and extend the perf overlay or use `Server-Timing` in DevTools (the overlay is currently Tag-only).
3. **Then, one screen per release or per PR:** Audit, Session History, Comparison, Self-Review, then the shared `VideoPanel`/`VideoWindow` (which also covers Insights).
4. **Per-screen acceptance:** the checklist in section 5, plus seek p95 under 50 ms on a 700 MB+ file, plus playback of at least 10 minutes without stalls.
5. **Drill:** analyse `serve_drive` first. It probably needs its own, similar change, with token handling kept intact.
6. **Final step:** when all screens use `?chunked=1`, make chunked the server default (or make `get_video_url` return it), keep a kill switch for one or two releases, then delete the original path.
7. Optional, measure first: `preload="auto"` on the element, so stepping while paused finds data already buffered; and a streaming body (so a dropped connection cancels the read).
