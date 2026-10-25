## MARK v7.12.20 — exports are now owned by the reviewer

Download the `.msi` or `.exe` installer below. Requirements: Windows 10+.

### What changed
All three Google exports now create their files with **the reviewer's own Google sign-in**, not mark-reporter's. The reviewer owns what is exported and **their** Google storage is used. (mark-reporter used to own every export, which filled its Drive.)

1. **Session History → Google Sheet.** The "MARK Review" sheet is created by the reviewer. It goes into the shared MARK Trainer Reviews folder when Google allows that; otherwise into the reviewer's own **MARK Reviews** folder in their Drive (created once, then reused). MARK only reports success after mark-reporter has actually read the sheet, so Self-Review can load it.
2. **Scout Done export** (spreadsheet + clips). Same rules, with the master folder tried first and the MARK Reviews folder as the fallback. The review is saved in MARK first; the local files (Downloads) are made before anything goes to Google.
3. **Audit export** (CSV + clips). Same as Scout Done.

### Failures are no longer hidden
- Scout Done used to say "All files saved and uploaded" even when clips or the sheet failed. It now reports the real failure.
- Every export that fails shows the real cause: *"Google storage is full for <account>…"* for a full Drive, *"Google didn't allow this export (<reason>)"* for a real permission refusal, and the actual error for anything else. Nothing says "ask Fady for access" unless it really is a permission problem.
- **Retry** continues where the export stopped: same Drive folder, only the files that did not upload, then the readability check again. It never starts over. Scout Done also has **Finish anyway**, so a Drive problem never blocks finishing a review.

### Sharing
The MARK Reviews folder is shared **once** with mark-reporter and with everyone at hudl.com (read-only); everything inside inherits it. There is no "anyone with the link" sharing.

### Offboarding — action needed
A reviewer's exports live in **their** Google account, so **their files vanish if the account is deleted**. Ownership of their MARK Reviews folder must be transferred (Google Workspace admin) when a reviewer leaves.

### Not changed
Existing exports under mark-reporter stay where they are. Tag mode, Drill, Comparison and scoring are unchanged in this version.
