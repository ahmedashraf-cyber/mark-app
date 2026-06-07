# TagPanel — Error Tagging Workflow
**Source of truth:** `App_Shortcuts.xlsx` Sheet1 (events + extras) × Sheet2 (error corrections)  
**Last verified:** June 2026  
**File:** `src/components/TagPanel.jsx`

---

## Overview

TagPanel is a bottom slide-up overlay triggered when a reviewer presses an event key.  
It follows a multi-step keyboard-only flow — no mouse, no typing.

```
Press event key (E, S, A...)
  → Step 1: Select error type (1-6)
  → Step 2: Select correction / extra (keyed list)
  → Step 3 (some paths): Select team (Home 1 / Away 2)
  → Auto-save
```

---

## Step 1 — Error Types

| Key | Error type | Auto-save? |
|-----|-----------|-----------|
| 1 | Wrong event | No → Step 2 (correction list) |
| 2 | Missing event | ✅ Yes |
| 3 | Extra event | ✅ Yes |
| 4 | Missing extra | No → Step 2 (extra list) |
| 5 | Wrong extra | No → Step 2 (pick extra) → Step 3 (correction) |
| 6 | Not needed extra | No → Step 2 (extra list) |

---

## Step 2A — Wrong Event Corrections (per event)

Keys assigned sequentially: 1,2,3...9,Q,W,E...  
Lists shown in 2-column grid when >5 items.

| Event (key) | Wrong event → correct it to |
|-------------|------------------------------|
| **Pass (E)** | Miscontrol, Dribble, Pass recovery, Pass interception, Tackle, Clearance, Shot, Fifty fifty, Interception, Ball recovery, Block |
| **Shot (S)** | Pass, Miscontrol, Clearance, Tackle, Dribble, GK (Smoother) |
| **Reception (W)** | Miscontrol, Tackle, Ball recovery |
| **Miscontrol (T)** | Dribble, Tackle, Pass, Shot, Clearance, Ball recovery, Block, Reception, Interception |
| **Tackle (K)** | Clearance, Block, Dribble, Fifty fifty, Miscontrol, Pass, Pass recovery, Pass interception, Leg stretch duel, Hold up duel, Separation duel |
| **Dribble (D)** | Tackle, Pass, Pass recovery, Pass interception, Miscontrol, Separation duel, Leg stretch duel, Hold up duel |
| **Interception (V)** | Ball recovery, Clearance, Pass recovery, Pass interception, Block, Tackle |
| **Ball recovery (R)** | Interception, Pass recovery, Pass interception, Block, Clearance, Fifty fifty, GK (Keeper sweeper), GK (Collected), Tackle |
| **Block (B)** | Tackle, Clearance, Interception, Miscontrol, Ball recovery, Pass, Pass recovery, Fifty fifty, Pass interception |
| **Clearance (F)** | Pass recovery, GK (Keeper sweeper), GK (Punch), Interception, Block, Fifty fifty, Tackle, Dribble, Shot, Ball recovery |
| **Pass recovery (P)** | Pass interception, Clearance, Ball recovery, Interception, Tackle, GK (Keeper sweeper), Miscontrol, Dribble, Fifty fifty |
| **Pass interception (I)** | Pass recovery, Clearance, Ball recovery, Interception, Tackle, Fifty fifty, Miscontrol, Dribble, GK (Keeper sweeper) |
| **Fifty fifty (0)** | Dribble, Pass recovery, Tackle, Positioning duel, Pass, Pass interception, Ball recovery, Interception |
| **Foul committed (X)** | Card |
| **Hold up duel (H)** | Positioning duel, Interception, Ball recovery, Shield, Leg stretch duel |
| **Positioning duel (Y)** | Shield, Tackle, Fifty fifty, Hold up duel |
| **Separation duel (L)** | Dribble, Miscontrol |
| **Leg stretch duel (M)** | Dribble, Tackle, Hold up duel, Positioning duel |
| **Shield (C)** | Hold up duel, Tackle, Ball recovery |
| **Goal keeper (G)** | First pick GK sub-type → then wrong event list |

### Goal keeper sub-types (Step 1.5 for GK only)

| Key | Sub-type | Wrong event corrections |
|-----|----------|------------------------|
| 1 | Collected | GK (Punch), Ball recovery |
| 2 | Punch | GK (Collected), GK (Save) |
| 3 | Keeper sweeper | Ball recovery, Clearance |
| 4 | Save | GK (Punch) |

---

## Step 2B — Missing Extra / Not Needed Extra (per event)

Select which extra is missing or not needed → auto-save after team selection.

| Event | Missing / not needed extras |
|-------|----------------------------|
| Pass (E) | Through ball, Backheel, Injury clearance, Launch, Miscommunication |
| Shot (S) | Aerial won, Backheel |
| Miscontrol (T) | Aerial won |
| Tackle (K) | Dribble attempted |
| Interception (V) | Miscommunication |
| Ball recovery (R) | Miscommunication |
| Block (B) | Deflection, Save, Miscommunication |
| Clearance (F) | Aerial won, Miscommunication |
| Pass recovery (P) | Through ball, Backheel, Injury clearance, Launch, Miscommunication |
| Pass interception (I) | Through ball, Backheel, Injury clearance, Launch, Miscommunication |
| Foul committed (X) | Advantage, Penalty |
| Goal keeper (G) | Miscommunication |
| Reception, Hold up duel, Positioning duel, Shield, Separation duel, Leg stretch duel, Pressure start | — (no extras) |

---

## Step 2C — Wrong Extra (per event)

First pick which extra was wrong, then pick the correction.

| Event | Wrong extras → corrections |
|-------|--------------------------|
| **Pass (E)** | Inswinging→Outswinging/Straight · Outswinging→Inswinging/Straight · Straight→Inswinging/Outswinging |
| **Shot (S)** | Aerial won→Regular/Step in · Diving header→Normal · Volley→Half volley · Half volley→Volley/Normal · Set→Prone/Moving · Prone→Set/Moving · Moving→Set/Prone · Open play→First time · First time→Open play |
| **Miscontrol (T)** | Regular→Handball/Dangerous play/Offside · Aerial won→Regular/Step in |
| **Tackle (K)** | Won→Success/Second effort · Success→Won/Second effort · Right→Left/Right take on/Left take on/None · Left→Right/Right take on/Left take on/None · Right take on→Right/Left/Left take on/None · Left take on→Right/Left/Right take on/None |
| **Dribble (D)** | Right→Left/Right take on/Left take on/None · Left→Right/Right take on/Left take on/None · Right take on→Right/Left/Left take on/None · Left take on→Right/Left/Right take on/None |
| **Interception (V)** | Step in→Aerial won · Won→Success/Second effort · Success→Won/Second effort |
| **Clearance (F)** | Regular→Handball/Dangerous play/Offside · Aerial won→Regular/Step in |
| **Pass interception (I)** | Step in→Aerial won |
| **Fifty fifty (0)** | Won→Success/Second effort · Success→Won/Second effort |
| **Foul committed (X)** | Regular→Handball/Dangerous play/Offside · Handball→Regular/Offside · Dangerous play→Regular/Handball/Offside · Offside→Regular/Handball/Dangerous play · No card→Yellow card/Second yellow/Red card · Yellow card→No card/Second yellow/Red card · Second yellow→No card/Yellow card/Red card · Red card→No card/Yellow card/Second yellow |
| **Goal keeper (G)** | Both hands→Right hand/Left hand · Diving→Standing · Standing→Diving · Set→Prone/Moving · Prone→Set/Moving · Moving→Set/Prone · Won→Success/Second effort · Success→Won/Second effort · Second effort→Won/Success |
| **Stoppage** | Injury→Review/Other · Review→Injury/Other · Other→Injury/Review |
| Reception, Hold up duel, Positioning duel, Shield, Separation duel, Leg stretch duel | — (no wrong extras) |

---

## UI Behavior

- **Panel position:** Fixed bottom, full width, slides up — identical to original TagPanel
- **Backdrop:** Semi-transparent blur overlay — click to cancel
- **Breadcrumb:** Shows path e.g. `Pass → Wrong event → Miscontrol`
- **Step label:** Colored indicator above each list
- **Key display:** Every option shows its keyboard shortcut key in orange mono
- **2-column grid:** Used when list has >5 items to keep it compact
- **Auto-save types:** Missing event (2) and Extra event (3) save immediately with green "auto" badge
- **ESC:** Cancels at any step
- **GK special flow:** Sub-type picker appears first before error type

---

## TagPanel Data Sources

All data verified against:
- **Sheet1** (App_Shortcuts.xlsx): Events with their extras/sub-fields per event
- **Sheet2** (App_Shortcuts.xlsx): Error correction guide — col E (tagged), col F (error type), col G (correction)

**Sheet2 column structure:**
- Col A = Extra/Event name (reference)
- Col C = Sub-type label (GK only)
- Col D = Sub-type shortcut
- Col E = What was tagged (the wrong thing)
- Col F = Error type (Wrong event / Missing extra / Wrong extra / etc.)
- Col G = Correction (what it should have been)
- Col I = Sub-type of correction (GK sub-type)

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Keep original panel position/style | Don't break muscle memory of reviewers |
| 2-column keyed grid for long lists | Max 6 rows visible vs 11 in single column |
| Keys 1-9 then Q,W,E,R... | Sequential, no gaps, easy to memorize |
| Missing/Extra event → auto-save | No correction needed, fastest path |
| Wrong extra has 2 sub-steps | First pick which extra was wrong, then which value to correct to |
| GK sub-type first | GK has 4 different sub-events with different wrong-event corrections |
| Per-event filtering | Show only extras relevant to that event — not a global 32-item list |
| Team selection last | Same pattern as original panel — confirms intent before save |
