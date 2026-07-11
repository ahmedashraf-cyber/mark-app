
## Session: 2026-07-11 — MARK v7.5.28

### CONFIRMED RULES
- Error = amendment by REVIEWER only (diagnostics.work: base=0, refinement=0, amendment>0)
- Specialist collector (players/location, base=0, refinement>5) = NOT reviewer
- Cross-collector corrections, self-corrections, system amendments = NOT errors
- Multiple reviewers per half supported
- Correct score for test match: 92% (was 77% — 15pp from specialist misclassification)

### BRIDGE CHANGES
- Bridge now sends `refinements` map (key_type → payload) for all reviewed events
- BRIDGE_VERSION and ASAR_MARKER must increment with every app version

### ERRORS TABLE
- 8 columns: Time | Event·Team | Error Type | Module | Before | After | Collector | Reviewer
- 12 error types: deletion, rename, replacement, wrong-event, wrong-timestamp, wrong-extras, wrong-location, wrong-player, freeze-frame, goal-location, squad, added
- Role detection uses diagnostics.work from bridge
- Timestamp format: MM:SS.mmm

### EXPORT
- Open in Drive: invoke('open_file') with rundll32
- Folder link (not file link)
- Half format: 1H→1st Half, 2H→2nd Half, ET1→ET 1
- Clip filenames: MM-SS.mmm format
- Sheet: native Google Sheet via upload_csv_as_sheet
- Sheet visual identity: PENDING (Sheets API batchUpdate silently failing)

### VERSIONS THIS SESSION
v7.5.20 → v7.5.28 (9 builds)

## Session: 2026-07-11 — MARK v7.5.28

### CONFIRMED RULES
- Error = amendment by REVIEWER only (diagnostics.work: base=0, refinement=0, amendment>0)
- Specialist collector (players/location, base=0, refinement>5) = NOT reviewer
- Cross-collector corrections, self-corrections, system amendments = NOT errors
- Multiple reviewers per half supported
- Correct score for test match: 92% (was 77% — 15pp from specialist misclassification)

### BRIDGE CHANGES
- Bridge now sends refinements map (key_type → payload) for all reviewed events
- BRIDGE_VERSION and ASAR_MARKER must increment with every app version — both were stuck at 7.5.4

### ERRORS TABLE
- 8 columns: Time | Event·Team | Error Type | Module | Before | After | Collector | Reviewer
- 12 error types: deletion, rename, replacement, wrong-event, wrong-timestamp, wrong-extras, wrong-location, wrong-player, freeze-frame, goal-location, squad, added
- Role detection uses diagnostics.work from bridge
- Timestamp format: MM:SS.mmm

### EXPORT
- Open in Drive: invoke('open_file') with rundll32
- Drive link points to folder not file
- Half format: 1H→1st Half, 2H→2nd Half, ET1→ET 1
- Clip filenames: MM-SS.mmm format
- Sheet: native Google Sheet via upload_csv_as_sheet
- Sheet visual identity: PENDING — Sheets API batchUpdate silently failing

### VERSIONS THIS SESSION
v7.5.20 → v7.5.28 (9 builds)
