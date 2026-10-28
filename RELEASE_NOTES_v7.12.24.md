## MARK v7.12.24 — Tag mode: instant seeking

Download the `.msi` or `.exe` installer below. Requirements: Windows 10+.

### What changed
**Seeking in Tag mode is now fast.** Jumping to a part of the video that isn't buffered yet used to take 350 to 1700 ms; it now takes a few milliseconds (in testing: slowest seek 1469 ms → 39 ms, typical 15 ms → 7 ms, no slow seeks).

Why it was slow: every time the player needed a different part of the video, MARK's built-in video server read the whole rest of the file into memory before sending the first byte (up to about 800 MB per seek). Tag mode now asks for the video in 4 MB pieces. The server also stopped answering a request for the very end of the file with the entire file (that happened over and over), and no longer reads the file just to answer a size check.

### What did NOT change
Scout review, Audit, Session History, Insights, Self-Review, Comparison and Drill keep the server behaviour they had before. Their requests are handled by the same code as in v7.12.21 (verified request by request). Speeding those up is planned as a separate step, one screen at a time.

### For testers
- Compare old and new behaviour in the same build: `localStorage.mark_video_legacy = '1'` (reload) switches Tag mode back to the previous server behaviour; remove it to return.
- `localStorage.mark_perf = '1'` shows the performance overlay and now also counts seeks, slow seeks and stalls. It also makes the video server write a per-request log to `%TEMP%\mark-video-trace.log`. Both are off by default.

### Reminder from v7.12.20
A reviewer's exports live in their own Google account, so their files vanish if the account is deleted. Ownership transfer is needed at offboarding.
