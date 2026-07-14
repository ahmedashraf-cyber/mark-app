/* ============================================================================
 * MARK — zero-intervention `categorizedEvents` extraction probe
 * ----------------------------------------------------------------------------
 * Paste into Tag Once DevTools (F12) with a match/half loaded (tracker NOT
 * required to be open). Confirms WHICH extraction path works before MARK trusts
 * the A/B/C scores, then prints the categories and the derived A/B/C so you can
 * eyeball them against the Event Review Tracker. Read-only; safe; no crash.
 *
 * Why the earlier attempts failed (and what this does instead):
 *  - `.on('updateQualityReviewToolList')` saw nothing: the main renderer SENDS
 *    that channel, it doesn't receive it. We tap `.send` (outgoing) instead.
 *  - `.send('requestQualityReviewTrackerData')` got no reply: `.send` goes to the
 *    MAIN PROCESS, not back to this renderer's own listener. We use `.emit(...)`
 *    which fires the LOCAL listener in-process — no window, no round trip.
 *  - fiber search for "qualityCategorizationContext" found nothing: the key is
 *    minified and XState state is circular (JSON.stringify throws → skipped). We
 *    walk cycle-safe and match by VALUE (category-name keys → arrays).
 * ==========================================================================*/
(async function () {
  'use strict';

  const A_CATS = ['lineupsAndFormation','substitutions','tacticalShifts','playerOff','playerOn',
    'goals','keyPassesBeforeShots','ownGoals','cards','fouls','offside','freeKickPass','corners',
    'errors','kickOffs','throughBalls','stoppage','freezeFrame','pressuresBeforeShots',
    'refereeBallDrop','endShots','g.K.-Actions-shots'];
  const B_CATS = ['Clearances','passRecoveries','interceptions','blocks','dribbles','tackles',
    'miscontrols','g.K.-Actions-Other','shields','fiftyFifty'];
  const C_CATS = ['ballRecovery','aerialLosts','pressures'];
  const ALL_CATS_SET = new Set([...A_CATS, ...B_CATS, ...C_CATS]);

  const ipc = (function () { try { return window.require && window.require('electron').ipcRenderer; } catch (_) { return null; } })();
  const out = { ipcAvailable: !!ipc, fiber: null, ipcEmit: null, chosen: null, categoryReport: null, abc: null };

  const looksCategorized = o => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const ks = Object.keys(o);
    if (ks.length < 3 || ks.length > 120) return false;
    let catHits = 0, arrKeys = 0;
    for (const k of ks) { if (ALL_CATS_SET.has(k)) catHits++; if (Array.isArray(o[k])) arrKeys++; }
    return catHits >= 3 || (arrKeys >= 5 && arrKeys === ks.length);
  };

  // ── Path 1: pure fiber / XState read ──────────────────────────────────────
  function readFiber(budgetMs) {
    const root = document.querySelector('#root') || document.body;
    if (!root) return null;
    const fkey = Object.keys(root).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
    if (!fkey) return null;
    let fiber = root[fkey]; if (fiber && fiber.current) fiber = fiber.current;
    const deadline = Date.now() + (budgetMs || 1500);
    let found = null, where = null;
    const scan = (val, seen, depth, path) => {
      if (found || !val || typeof val !== 'object' || depth > 8 || seen.has(val)) return;
      seen.add(val);
      if (typeof val.getSnapshot === 'function') { try { const s = val.getSnapshot(); if (s && s.context) scan(s.context, seen, depth + 1, path + '.getSnapshot().context'); } catch (_) {} }
      if (val.categorizedEvents && looksCategorized(val.categorizedEvents)) { found = val.categorizedEvents; where = path + '.categorizedEvents'; return; }
      if (looksCategorized(val)) { found = val; where = path; return; }
      const ks = Object.keys(val);
      for (let i = 0; i < ks.length && i < 300 && !found; i++) { try { scan(val[ks[i]], seen, depth + 1, path + '.' + ks[i]); } catch (_) {} }
    };
    const seenFibers = new Set(); const stack = [fiber]; let n = 0;
    while (stack.length && n < 60000 && !found && Date.now() < deadline) {
      const f = stack.pop(); if (!f || seenFibers.has(f)) continue; seenFibers.add(f); n++;
      const cn = (f.type && (f.type.displayName || f.type.name)) || '?';
      try { let h = f.memoizedState, hc = 0; while (h && hc < 40 && !found) { scan(h.memoizedState, new Set(), 0, cn + '#hook' + hc); h = h.next; hc++; } } catch (_) {}
      try { scan(f.memoizedProps, new Set(), 0, cn + '.props'); } catch (_) {}
      if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
    }
    return found ? { categorizedEvents: found, where, fibersScanned: n } : { categorizedEvents: null, fibersScanned: n };
  }

  // ── Path 2: local emit + read-only send-tap ───────────────────────────────
  function installTap() {
    if (!ipc || typeof ipc.send !== 'function') return false;
    if (ipc.__markProbeTapped) return true;
    const orig = ipc.send.bind(ipc);
    ipc.send = function (channel) {
      if (channel === 'updateQualityReviewToolList') { try { window.__MARK_QRT__ = arguments[1]; window.__MARK_QRT_TS__ = Date.now(); } catch (_) {} }
      return orig.apply(ipc, arguments);
    };
    ipc.__markProbeTapped = true;
    return true;
  }
  async function viaIpc(timeoutMs) {
    if (!installTap()) return { ok: false, reason: 'ipc/send unavailable' };
    const before = window.__MARK_QRT_TS__ || 0;
    let emitted = false;
    try { if (typeof ipc.emit === 'function') { ipc.emit('requestQualityReviewTrackerData', {}); emitted = true; } } catch (e) { return { ok: false, reason: 'emit threw: ' + (e && e.message) }; }
    const start = Date.now();
    while (Date.now() - start < (timeoutMs || 2000)) {
      const p = window.__MARK_QRT__;
      if (p && (window.__MARK_QRT_TS__ || 0) >= before && p.qualityCategorizationContext && p.qualityCategorizationContext.categorizedEvents)
        return { ok: true, emitted, categorizedEvents: p.qualityCategorizationContext.categorizedEvents };
      await new Promise(r => setTimeout(r, 50));
    }
    const p = window.__MARK_QRT__;
    return { ok: !!(p && p.qualityCategorizationContext), emitted, passiveOnly: true,
      categorizedEvents: (p && p.qualityCategorizationContext && p.qualityCategorizationContext.categorizedEvents) || null };
  }

  // ── Run both, choose, report ──────────────────────────────────────────────
  try { out.fiber = readFiber(1500); } catch (e) { out.fiber = { error: String(e) }; }
  try { out.ipcEmit = await viaIpc(2000); } catch (e) { out.ipcEmit = { error: String(e) }; }

  const catEvents = (out.fiber && out.fiber.categorizedEvents) || (out.ipcEmit && out.ipcEmit.categorizedEvents) || null;
  out.chosen = (out.fiber && out.fiber.categorizedEvents) ? 'fiber' : (catEvents ? 'ipc-emit' : 'NONE');

  if (catEvents) {
    const known = Object.keys(catEvents).filter(k => ALL_CATS_SET.has(k));
    const unknown = Object.keys(catEvents).filter(k => !ALL_CATS_SET.has(k));
    out.categoryReport = {
      total: Object.keys(catEvents).length,
      countsByCategory: Object.fromEntries(Object.entries(catEvents).map(([k, v]) => [k, Array.isArray(v) ? v.length : '?'])),
      unmappedCategories: unknown, // any of these means the A/B/C lists need updating
    };
    // Total-event A/B/C (not reviewer-filtered) — for sanity-checking the tracker counts.
    const sizeOf = cats => cats.reduce((s, c) => s + ((catEvents[c] && catEvents[c].length) || 0), 0);
    out.abc = { A_total: sizeOf(A_CATS), B_total: sizeOf(B_CATS), C_total: sizeOf(C_CATS),
      note: 'These are TOTAL events per group. The tracker % and MARK score also divide by reviewer-viewed events; run in MARK for the scored version.' };
  }

  window.__MARK_CE__ = { report: out, categorizedEvents: catEvents };
  console.log('%c=== categorizedEvents extraction probe ===', 'font-weight:bold;font-size:14px;color:#e8500a');
  console.log('chosen path:', out.chosen);
  console.log('fiber read:', out.fiber && (out.fiber.where || out.fiber.categorizedEvents ? 'FOUND at ' + out.fiber.where : 'not found (' + (out.fiber && out.fiber.fibersScanned) + ' fibers)'));
  console.log('ipc emit+tap:', out.ipcEmit);
  console.log('category report:', out.categoryReport);
  console.log('A/B/C totals:', out.abc);
  if (out.categoryReport && out.categoryReport.unmappedCategories.length)
    console.warn('⚠ categories NOT in A/B/C lists (update the mapping):', out.categoryReport.unmappedCategories);
  console.log('Full result + raw categorizedEvents on  window.__MARK_CE__');
  return out;
})();
