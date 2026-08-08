# MARK — Productivity Feature Research
**Status:** Console-confirmed, NOT YET BUILT into MARK
**Last updated:** 2026-08-08
**Session:** Full investigation on matches 1294780 and 1444657

---

## 1. Definition

**Productivity** measures how much of a full match a collector has completed across all modules.

**Formula:**
```
productivity = total completed module-halves / 12
```

- 12 = 6 modules × 2 halves = full match
- Each module in each half = 1 unit if ≥95% complete, 0 if <95%
- No partial credit below 95%

**Examples:**
```
6/6 modules in half 1 + 0/6 in half 2 = 6/12 = 0.50  (collector did 1 full half)
6/6 modules in half 1 + 3/6 in half 2 = 9/12 = 0.75
6/6 modules in half 1 + 6/6 in half 2 = 12/12 = 1.00  (full match complete)
2/6 modules in half 1 + 0/6 in half 2 = 2/12 = 0.17
```

---

## 2. The 6 Modules

| Module | Done condition | Data source |
|--------|---------------|-------------|
| Base+Extras | extras completion ≥95% | `required-partials` vs refinements |
| Pressure | collector has any pressure events in this half | base events with name=pressure-start/end |
| Players | players completion ≥95% | `required-partials` vs refinements |
| Location | location completion ≥95% | `required-partials` vs refinements |
| Freeze-frame | goal-location completion ≥95% (fallback: any FF refs exist) | `required-partials` vs refinements |
| Validation | 0 validation errors | ValidationLog via IPC tap OR cache replication |

**All modules equal weight (1/12 each). Confirmed decision.**

---

## 3. Completion % Calculation (Confirmed)

```javascript
// For modules: players, location, extras, goal-location
function calcCompletion(authorId, module, halfEvents) {
  const IGNORE = new Set(['clocks'])
  const deletedKeys = new Set(
    halfEvents.filter(v=>v.category==='amendment'&&v.type==='deletion').map(v=>v.key)
  )
  const refinementMap = {}
  halfEvents.forEach(v => {
    if (v.category!=='refinement') return
    if (!refinementMap[v.key]) refinementMap[v.key] = new Set()
    refinementMap[v.key].add(v.type)
  })
  const myBase = halfEvents.filter(v =>
    v.author===authorId && v.category==='base' && v.payload?.videoTimestamp!=null &&
    !deletedKeys.has(v.key)
  )
  const requires = myBase.filter(v =>
    (v.payload?.['required-partials']||[]).filter(p=>!IGNORE.has(p)).includes(module)
  )
  if (!requires.length) return { pct: null, done: false, na: true }
  const filled = requires.filter(v => refinementMap[v.key]?.has(module)).length
  const pct = Math.round((filled/requires.length)*100)
  return { pct, filled, total: requires.length, done: pct >= 95 }
}
```

**Critical rule confirmed:** Deleted events MUST be excluded from denominator.
Match 1444657: 229 missing partials → 0 after excluding deleted → ✅ matches Tag Once exactly.

---

## 4. Validation Module — Confirmed Rule

**IPC method (requires button click):**
```javascript
// openValidationWindow fires → errors exist → validation NOT done
// validationApiResponse with currentState=loaded fires WITHOUT openValidationWindow → 0 errors → DONE
```

**Cache replication method (no button click needed):**
```javascript
// CONFIRMED PERFECT MATCH on match 1444657 (both methods give 0)
function computeValidationErrors(halfEvents) {
  const IGNORE = new Set(['clocks'])
  const deletedKeys = new Set(
    halfEvents.filter(v=>v.category==='amendment'&&v.type==='deletion').map(v=>v.key)
  )
  const refinementMap = {}
  halfEvents.forEach(v => {
    if (v.category!=='refinement') return
    if (!refinementMap[v.key]) refinementMap[v.key] = new Set()
    refinementMap[v.key].add(v.type)
  })
  const seenKeys = new Set()
  const baseHalf = halfEvents.filter(v => {
    if (v.category!=='base'||v.payload?.videoTimestamp==null) return false
    if (seenKeys.has(v.key)) return false
    seenKeys.add(v.key); return true
  })
  const errorEvents = new Set()
  baseHalf.forEach(v => {
    if (deletedKeys.has(v.key)) return  // CRITICAL: skip deleted
    const required = (v.payload?.['required-partials']||[]).filter(p=>!IGNORE.has(p))
    const missing = required.filter(m => !refinementMap[v.key]?.has(m))
    if (missing.length > 0) errorEvents.add(v.key)
  })
  return errorEvents.size  // 0 = validation done
}
```

**Test results:**
- Match 1444657 half 1: computed=0, IPC=0 → ✅ PERFECT MATCH
- Match 1294780 half 1: computed=418 unique error events, IPC=977 total missing instances
  (different count because 977 = total instances across all events, 418 = unique events)

---

## 5. Confirmed Console Snippet (Full Productivity)

Run this in Tag Once console for any match+half currently open:

```javascript
(async function markProductivity() {
  const GAP_MS         = 5 * 60 * 1000
  const DONE_THRESHOLD = 95
  const IGNORE         = new Set(['clocks'])

  const cache     = window.apollo.client.cache.extract()
  const allEvents = Object.values(cache).filter(v => v.__typename === 'Event')

  // ── Detect current half ───────────────────────────────────────────────────
  const halfStart = allEvents
    .filter(v => v.category==='base' && v.payload?.name==='half-start' && v.matchId)
    .sort((a,b) => (b.capturedTime||'').localeCompare(a.capturedTime||''))[0]
  const currentMatchId = halfStart?.matchId
  const currentPartId  = halfStart?.partId
  console.log('Match:', currentMatchId, '| Half:', currentPartId)

  const halfEvents = allEvents.filter(v =>
    (v.matchId===currentMatchId||v.matchId===String(currentMatchId)) &&
    (v.partId===currentPartId||v.partId===String(currentPartId))
  )

  // ── Reviewer detection ────────────────────────────────────────────────────
  const viewCounts = {}
  halfEvents.filter(v=>v.category==='telemetry')
    .forEach(v=>{viewCounts[v.author]=(viewCounts[v.author]||0)+1})
  const reviewerId = Number(Object.entries(viewCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]??0)

  // ── Collector detection ───────────────────────────────────────────────────
  const BASE_EXCL = new Set(['starting-xi','half-start','half-end','squad','pressure-start','pressure-end'])
  const baseCountPerColl = {}
  halfEvents.filter(v =>
    v.category==='base' && v.payload?.videoTimestamp!=null &&
    !BASE_EXCL.has(v.payload?.name) && v.author!==reviewerId
  ).forEach(v=>{baseCountPerColl[v.author]=(baseCountPerColl[v.author]||0)+1})

  let collectorIds = Object.keys(baseCountPerColl).map(Number)
    .filter(a=>{
      const refCount=halfEvents.filter(v=>v.author===a&&v.category==='refinement').length
      return (baseCountPerColl[a]||0)+refCount>600
    })
    .sort((a,b)=>baseCountPerColl[b]-baseCountPerColl[a])
  if (!collectorIds.length) collectorIds=[Number(Object.keys(baseCountPerColl).sort((a,b)=>baseCountPerColl[b]-baseCountPerColl[a])[0])]

  const mainCollector = collectorIds.find(id=>
    halfEvents.some(v=>v.author===id&&v.category==='base'&&v.payload?.name==='half-start')&&
    halfEvents.some(v=>v.author===id&&v.category==='base'&&v.payload?.name==='half-end')
  )??collectorIds[0]

  // ── Build maps ────────────────────────────────────────────────────────────
  const deletedKeys = new Set(
    halfEvents.filter(v=>v.category==='amendment'&&v.type==='deletion').map(v=>v.key)
  )
  const refinementMap = {}
  halfEvents.forEach(v=>{
    if(v.category!=='refinement')return
    if(!refinementMap[v.key])refinementMap[v.key]=new Set()
    refinementMap[v.key].add(v.type)
  })
  const seenKeys=new Set()
  const baseHalf=halfEvents.filter(v=>{
    if(v.category!=='base'||v.payload?.videoTimestamp==null)return false
    if(seenKeys.has(v.key))return false
    seenKeys.add(v.key);return true
  })

  const calcComp=(authorId,module)=>{
    const myBase=baseHalf.filter(v=>v.author===authorId&&!deletedKeys.has(v.key))
    const requires=myBase.filter(v=>(v.payload?.['required-partials']||[]).filter(p=>!IGNORE.has(p)).includes(module))
    if(!requires.length)return{pct:null,done:false,na:true}
    const filled=requires.filter(v=>refinementMap[v.key]?.has(module)).length
    const pct=Math.round((filled/requires.length)*100)
    return{pct,filled,total:requires.length,done:pct>=DONE_THRESHOLD}
  }

  const totalPressureInHalf=halfEvents.filter(v=>
    v.category==='base'&&(v.payload?.name==='pressure-start'||v.payload?.name==='pressure-end')
  ).length

  // ── Validation via cache replication ─────────────────────────────────────
  const errorEvents=new Set()
  baseHalf.forEach(v=>{
    if(deletedKeys.has(v.key))return
    const required=(v.payload?.['required-partials']||[]).filter(p=>!IGNORE.has(p))
    const missing=required.filter(m=>!refinementMap[v.key]?.has(m))
    if(missing.length>0)errorEvents.add(v.key)
  })
  const validationDone = errorEvents.size===0

  // ── Per-collector productivity ────────────────────────────────────────────
  const results=[]
  collectorIds.forEach(cId=>{
    const extrasComp  =calcComp(cId,'extras')
    const playersComp =calcComp(cId,'players')
    const locationComp=calcComp(cId,'location')
    const glComp      =calcComp(cId,'goal-location')
    const ffComp      =glComp.na?()=>{
      const ffRefs=halfEvents.filter(v=>v.author===cId&&(v.category==='refinement'||v.category==='amendment')&&(v.type==='freeze-frame'||v.type==='impact'))
      return ffRefs.length>0?{pct:100,done:true,na:false}:{pct:null,done:false,na:true}
    }():glComp

    const collPressure=halfEvents.filter(v=>v.author===cId&&v.category==='base'&&(v.payload?.name==='pressure-start'||v.payload?.name==='pressure-end')).length
    const pressureDone=totalPressureInHalf>0?collPressure>0:null

    const modules={
      'Base+Extras': {done:extrasComp.done,   display:extrasComp.na?'N/A':`${extrasComp.pct}%`},
      'Pressure':    {done:pressureDone??false,display:pressureDone===null?'N/A':pressureDone?'✅':'❌'},
      'Players':     {done:playersComp.done,   display:playersComp.na?'N/A':`${playersComp.pct}%`},
      'Location':    {done:locationComp.done,  display:locationComp.na?'N/A':`${locationComp.pct}%`},
      'Freeze-frame':{done:ffComp.done,        display:ffComp.na?'N/A':`${ffComp.pct}%`},
      'Validation':  {done:validationDone,     display:validationDone?'✅ 0 errors':`❌ ${errorEvents.size} events`},
    }

    const doneCount=Object.values(modules).filter(m=>m.done).length
    results.push({cId,role:cId===mainCollector?'MAIN':'SEC',modules,doneCount,productivity:doneCount/12})
  })

  // ── Output ────────────────────────────────────────────────────────────────
  console.log(`\n══ PRODUCTIVITY — Match ${currentMatchId} Half ${currentPartId} ══`)
  results.forEach(r=>{
    console.log(`\nCollector ${r.cId} (${r.role}):`)
    console.table(Object.entries(r.modules).map(([mod,d])=>({module:mod,completion:d.display,done:d.done?'✅':'❌'})))
    console.log(`→ ${r.doneCount}/6 modules = ${r.doneCount}/12 of full match = ${(r.productivity*100).toFixed(1)}%`)
  })

  const total=results.reduce((s,r)=>s+r.doneCount,0)
  console.log(`\nCombined this half: ${total}/${results.length*6} = ${(total/(results.length*12)*100).toFixed(1)}% of full match per collector`)
  return results
})()
```

---

## 6. Validation History Investigation — Full Summary

### Goal
Find historical validation error data — who fixed which errors, when.

### What We Tried

| Location | Method | Result |
|----------|--------|--------|
| Apollo cache | `window.apollo.client.cache.extract()` | No ValidationLog objects in cache |
| localStorage | Loop all keys | No validation data |
| sessionStorage | Loop all keys | No validation data |
| IndexedDB | `indexedDB.databases()` | Only firebase-heartbeat-database + firebaseLocalStorageDb |
| File system AppData | Node.js `fs.readFileSync` | No validation logs in any .ldb/.log file |
| React fiber tree | Walk `__reactFiber` | No validation state in any component |
| Window globals | Scan 1192 properties | Only `process` and `__SENTRY__` matched — no validation data |
| Network calls | Intercept fetch + XHR | Zero network calls during validation |
| IPC channels (all 19) | `ipcR.on()` for all channels | `requestValidationData` and `runValidation` respond with `{}` |
| Electron remote | `require('@electron/remote')` | Not available in this version |
| GraphQL introspection | Apollo `__schema` query | Found `ValidationLog` and `ValidationResponse` types but no `resolvedAt`/`resolvedBy` fields |

### Key Finding
Tag Once computes validation errors **on-demand** from current Apollo cache state.
There is no persistence layer. Errors that were fixed simply disappear.

### What We CAN Do (Confirmed Working)
**Cache replication** perfectly matches Tag Once's live IPC:
- Non-deleted base events with missing `required-partials` = validation errors
- Confirmed match on match 1444657 (both = 0 errors ✅)
- This gives: current error count, per-collector attribution, per-module breakdown
- Does NOT give: history of past errors, timestamps of fixes, who fixed what

### Future Investigation Angles (Not Yet Tried)
1. **ASAR bundle read** — `C:\Users\...\live-collection-app\resources\app.asar`
   Read Tag Once source code directly to find validation implementation
2. **StatsBomb backend API** — Does `process.env.LIVE_COLLECTION_SERVICE_URL` expose validation history?
3. **WebSocket interception** — Does Tag Once receive validation updates via WS from server?

---

## 7. Action Items to Build Productivity in MARK

### Bridge changes needed (`bridge_script.js`):
- [ ] Add `productivityData` computation after `speedData`
- [ ] Use `computeValidationErrors()` (cache replication, no IPC tap needed)
- [ ] Compute per-collector per-module done/not-done + productivity score
- [ ] Send `productivityData` in `qaResultsResponse`

### AuditDashboard changes needed (`AuditPage.jsx`):
- [ ] Add productivity score to each collector panel header
  - Show as fraction: `3/6` or `0.25`
  - Show per-module done/not-done badges
- [ ] Add productivity to the stats bar
- [ ] Consider showing a "full match productivity" if both halves have been audited

### Firestore changes needed:
- [ ] Save `productivityData` in `mark_audit_sessions` document
- [ ] Save `halfValidationErrors` count (for tracking over time)

### Data shape for bridge to send:
```javascript
productivityData = {
  [collectorId]: {
    modules: {
      baseExtras:   { done: true/false,  pct: 97 },
      pressure:     { done: true/false,  count: 270 },
      players:      { done: false,       pct: 59.9 },
      location:     { done: false,       pct: 60.3 },
      freezeFrame:  { done: false,       pct: 57.1 },
      validation:   { done: true/false,  errorCount: 0 },
    },
    doneCount:    3,           // modules done (out of 6)
    productivity: 0.25,        // doneCount / 12 (toward full match)
  }
}
```

