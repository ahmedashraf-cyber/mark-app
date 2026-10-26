## MARK v7.12.21 — Tag mode: every event has a team

Download the `.msi` or `.exe` installer below. Requirements: Windows 10+.

This version is **Tag mode only**. It is built on v7.12.20 (reviewer-owned Google exports), which it therefore includes unchanged.

### What changed
1. **No more Match lane.** Camera off, Camera on, Stoppage, Half end, Match status and Unknown pass end now ask **Home / Away** (keys **1** and **2**) in All events, like every other event, and are saved with `teamSource = manual`. They appear in the Home or Away lane — never in a lane of their own.
2. **End stoppage button** in the OFFENSE panel, directly under Stoppage (click only, no hotkey, in both collection methods).
   - Greyed with "No open stoppage" until a Stoppage is open.
   - It closes the open Stoppage (same pair, `duration_ms` set) and takes that Stoppage's team (`teamSource = inherited`) — no question asked.
   - A second Stoppage while one is open is refused: "Close the open stoppage first".
3. **Half end can be cancelled safely.** Pressing Esc at its Home/Away question now leaves everything open exactly as it was. Before, a cancelled Half end had already closed the open Stoppage, Pressure and Shot.
4. **Old sessions.** Events saved earlier with no team show in a muted **Unassigned** row below Away (only when there are some). Nothing was migrated or rewritten.

### Unchanged on purpose
- Pass completion: a Stoppage, End stoppage, Half end, Match status or Unknown pass end can never count as a reception, so the pass before one stays "incomplete" exactly as before, whatever team is chosen.
- Not all events (all other behaviour), Scout, Drill, Comparison and scoring.
- Comparison may now list `wrong_side` rows for these events when a collector's team differs from the model's. `wrong_side` is not scored.

### Reminder from v7.12.20
A reviewer's exports live in their own Google account, so their files vanish if the account is deleted. Ownership transfer is needed at offboarding.
