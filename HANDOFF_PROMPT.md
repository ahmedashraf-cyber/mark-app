# MARK — Handoff Prompt (Next Session)

Copy this entire prompt at the start of a new Claude session.

---

## WHO YOU ARE / WHAT THIS IS

You are continuing development of **MARK** — a Tauri 2 + React 19 Windows desktop app
for QA review of football match data collected via StatsBomb's Tag Once app.
Built for Hudl Egypt's training operations team.

**Repos:**
- MARK: https://github.com/ahmedashraf-cyber/mark-app
- FIELD: https://github.com/ahmedashraf-cyber/flowops
- Token: ask Ahmed (regenerated per session)

**Current version:** 7.8.2
**Firebase project:** hudl-training-ops

---

## SESSION SETUP (do this first, every session)

```bash
cd /home/claude
git clone https://ahmedashraf-cyber:TOKEN@github.com/ahmedashraf-cyber/mark-app.git mark_review2
cd mark_review2
git config user.email "ahmed.ashraf@hudl.com"
git config user.name "Ahmed Ashraf"
```

Read ALL MD files before doing anything:
- DECISIONS.md — why everything works the way it does
- MARK_CONTEXT.md — full technical context
- ECOSYSTEM.md — MARK + FIELD relationship
- MODULE_SCORES.md — scoring methodology

---

## CURRENT STATE (as of 2026-07-28)

### What's working
- Bridge v7.8.2 injected into Tag Once via ASAR patch
- Error engine (5 rules) running in bridge, confirmed on match 1294780
- computedErrors: 41-43 | computedFFErrors: 1 | Overall: 96%
- Reviewer detection: top viewer only (author 2119, 1005 views)
- Reviewed count: 1005 (confirmed correct via deep console testing)
- Score cards: Overall 96%, A/B/C show dash on completed matches (no capturedCats)
- FF errors table in UI (below main errors table)
- CSV export includes both errors and FF errors
- WS timeout: 30 seconds

### Pending issues

**1. Apollo cache dedup (deduped=9116, should be ~2500)**
The error engine deduplicates but still gets 9116 events for match 1294780.
The error counts ARE correct despite this.

**2. A/B/C scores empty on completed matches**
reviewGroupScores failed: tracker button not found in DOM
Fix: capture and store capturedCats in Firestore during the review session.

**3. Speed metrics NOT in UI yet**
All speed metrics confirmed from console testing (DECISIONS.md #24) but
NOT yet built into MARK's UI. Awaiting permission from Ahmed.

**4. FIELD pending roles**
Training Supervisor and Trainee roles not yet built in FIELD.

---

## CRITICAL RULES (never break these)

### Version bump — ALL 5 files must match:
1. package.json
2. src-tauri/Cargo.toml
3. src-tauri/tauri.conf.json (version + title)
4. src-tauri/src/bridge_script.js (BRIDGE_VERSION)
5. src-tauri/src/main.rs (ASAR_MARKER)

ASAR_MARKER MUST be bumped every time — if Tag Once already has the old marker
in app.html, new bridge will never be injected.

### JS balance check after every edit:
```bash
node -e "const c=require('fs').readFileSync('src/pages/AuditPage.jsx','utf8'); let o=0,cl=0; for(const ch of c){if(ch==='{')o++;if(ch==='}')cl++;} console.log(o===cl?'OK':'MISMATCH',o,cl)"
```

---

## ERROR ENGINE — 5 RULES (confirmed, do not change without Ahmed)

All computed in bridge_script.js inside error engine try/catch block.

**Rule 1:** Self-edits excluded — reviewer amending own added events = not errors
**Rule 2:** Same value excluded — old payload == new payload = skip
**Rule 3:** Deleted+Added / Deleted+Edited — pair by +-1000ms, same name = edited
**Rule 4:** Location threshold — euclidean distance > 5 units only
  - location: payload.location.actual.x/y
  - goal-location: payload['goal-location'].x/y
**Rule 5:** Freeze frame shots only — join players by playerId, resolve roles by index

---

## SPEED METRICS (confirmed 2026-07-28, not yet in UI)

**Gap threshold:** 5 minutes — gaps >5min excluded from active time
**Collector time:** capturedTime of base/refinement events
**Reviewer time:** activatedAt to deactivatedAt from telemetry, cap at 5min

**Confirmed for match 1294780:**
- 3416 (Main Collector): 5:49:42 active, 637 ev/hr (base+refinements)
- 1935 (Secondary Collector): 3:53:20 active, 596 ev/hr (base+refinements)
- 2119 (Reviewer): 0:32:31 active, 1854 ev/hr (1.9s avg watch per event)

**Reviewer two-phase pattern:**
- Phase 1 (2:47-3:25 PM): 358 events, 4.7% error rate, 3.1s avg watch
- Phase 2 (3:41-4:03 PM): 647 events, 4.6% error rate, 1.3s avg watch

---

## MATCH 1294780 — DEEP TEST DATA

Match: Saint-Etienne vs. Angers, 1st Half
Authors:
- 3416: Main Collector — 1416 base, 2295 refinements, 1528 self-amendments
- 1935: Secondary Collector — 949 base, 1367 refinements, 310 self-amendments
- 2119: Reviewer — 1005 views, 56 amendments (errors found), 10 base (missed events)
- 2909: Playthrough viewer — 23 views, 0 amendments — excluded from all metrics

Confirmed scores: Overall 96% (1005 viewed, 43 errors)

---

## FREEZE FRAME PAYLOAD (critical for Rule 5)

```js
payload.freezeFrame.players[i] = {
  id: N,                    // array INDEX — NOT player identity
  playerId: 1049,           // actual player identity — use this
  groupIndicator: 'TEAM_A', // TEAM_A, TEAM_B, REF, KEEPER
  pitchPosition: { default: { x: 45.2, y: 30.1 } }
}
payload.freezeFrame.roles = {
  keeper:   [3],   // INDEX into players array
  shooter:  [7],
  opponent: [13]
}
// Resolve role: players[roles.keeper[0]].playerId
```

---

## VISUAL IDENTITY

Dark-first, Apple-style. Accent: #E8590C (Hudl Orange).
Fonts: Inter (headings), DM Sans (body), JetBrains Mono (codes).
Score cards: Overall=orange, A=blue(#0A84FF), B=green(#30D158),
C=yellow(#FFD60A), Others=purple(#BF5AF2).

---

## ECOSYSTEM

FIELD (flowops) = training operations web platform
- Batch Coordinator, Batch Supervisor, Batch Trainer, Training Manager roles built
- Training Supervisor and Trainee roles PENDING
- MARK scores flow into FIELD via Firestore
- FIELD token: ask Ahmed
- Working file: /home/claude/flowops_final.html
- Push dir: /home/claude/flowops_push/

