/* ============================================================================
 * MARK — Tag Once "Quality Review Tracker" group discovery
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A one-shot diagnostic you paste into the Tag Once DevTools console (F12) to
 *   answer ONE question: how do the 6 internal review groups
 *       gg=carry  _g=defense  yg=looseO  jg=looseD  Cg=flightO  Sg=flightD
 *   map onto the 3 display labels A-Review / B-Review / C-Review?
 *
 * WHY THE EARLIER ATTEMPTS FAILED
 *   - Grepping renderer.prod.js: minification renamed the vars, and "A-Review"
 *     is BUILT at runtime (letter + "-Review" / i18n / array index), so it is
 *     not a source literal. You cannot grep for text that never existed.
 *   - Fiber props for the string "carry": the tracker holds minified keys or
 *     pre-summed counts, not the readable name.
 *
 * THE WINNING IDEA
 *   Names get minified; VALUES do not. This script reads Tag Once's LIVE
 *   webpack module registry and pulls out the actual runtime objects
 *   (`Ug` = the 6-group list, `Qg` = the rules) by matching on their shape and
 *   contents, then finds whatever object next to them arrays the 6 into 3.
 *   Four independent strategies run; each prints its own answer so they can be
 *   cross-checked. Read-only — it requires nothing, mutates nothing.
 *
 * HOW TO RUN
 *   1. Open Tag Once, load a match/half that shows the tracker (e.g. A=46,
 *      B=126, C=208 in your example).
 *   2. F12 → Console → paste this whole file → Enter.
 *   3. Copy the "=== FINAL ANSWER ===" block back to MARK.
 *
 * The full result object is also left on  window.__MARK_RG__  for inspection,
 * and copied to your clipboard (as JSON) when the browser allows it.
 * ==========================================================================*/
(function () {
  'use strict';

  // The 6 internal group name strings, in the documented Ug order.
  const NAMES = ['carry', 'defense', 'looseO', 'looseD', 'flightO', 'flightD'];
  const NAME_SET = new Set(NAMES);
  // Your reported tracker counts — the arithmetic check falls back to these if
  // it can't scrape them from the DOM. EDIT if you run on a different half.
  const KNOWN_ABC = { A: 46, B: 126, C: 208 };

  const result = {
    strategy1_webpack: { require: false, Ug: null, Qg: null, abcCandidates: [], reviewStrings: [] },
    strategy2_fiber:   { hits: [] },
    strategy3_arith:   { perGroup: null, abcTargets: null, mapping: null, note: null },
    strategy4_dom:     { abcCounts: [] },
    finalAnswer:       null,
  };

  const short = (v, n = 400) => { try { return JSON.stringify(v).slice(0, n); } catch (_) { return String(v).slice(0, n); } };

  // ── Strategy 1: live webpack module registry (primary) ────────────────────
  // Hijack the chunk array to get __webpack_require__, then read the exports of
  // every already-instantiated module and match Ug / Qg / the A-B-C config by
  // VALUE. The tracker is on screen, so its module is instantiated.
  function getWebpackRequire() {
    const keys = Object.keys(window).filter(k => /^webpackChunk/.test(k));
    for (const k of keys) {
      const chunk = window[k];
      if (!Array.isArray(chunk) || typeof chunk.push !== 'function') continue;
      let req = null;
      try {
        // The 3rd tuple element is the runtime executor: called with the require.
        chunk.push([['__mark_probe_' + Math.random().toString(36).slice(2)], {}, r => { req = r; }]);
      } catch (_) {}
      if (req && (req.c || req.m)) return req;
    }
    return null;
  }

  // Deep, bounded, cycle-safe scan of one export value. Calls back on every
  // object/array it visits so the matchers below can inspect it.
  function walk(value, visit, seen = new Set(), depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return;
    seen.add(value);
    visit(value);
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length && i < 200; i++) {
      try { walk(value[keys[i]], visit, seen, depth + 1); } catch (_) {}
    }
  }

  const isGroupRules = o =>
    o && typeof o === 'object' && ('rules' in o || 'postRules' in o);

  function scanWebpack() {
    const req = getWebpackRequire();
    if (!req) return;
    result.strategy1_webpack.require = true;
    const cache = req.c || {};
    const seenGlobal = new Set();

    for (const id of Object.keys(cache)) {
      const mod = cache[id];
      const exp = mod && mod.exports;
      if (!exp || typeof exp !== 'object') continue;

      walk(exp, node => {
        // Ug — an array holding ≥4 of the known group-name strings.
        if (Array.isArray(node)) {
          const strs = node.filter(x => typeof x === 'string');
          const hit = strs.filter(s => NAME_SET.has(s));
          if (hit.length >= 4 && !result.strategy1_webpack.Ug) {
            result.strategy1_webpack.Ug = { moduleId: id, value: node.slice() };
          }
          // An A/B/C config is often an array of length 3 whose entries
          // reference the group names (or carry a "Review"/letter label).
          if (node.length === 3) {
            const dump = short(node, 1200);
            if (NAMES.some(n => dump.includes(n)) || /review/i.test(dump)) {
              result.strategy1_webpack.abcCandidates.push({ moduleId: id, kind: 'array3', value: node });
            }
          }
        }

        // Qg — a plain object keyed by the group names, values have rules/postRules.
        if (node && node.constructor === Object) {
          const keys = Object.keys(node);
          const keyHits = keys.filter(k => NAME_SET.has(k));
          if (keyHits.length >= 4 && keyHits.every(k => isGroupRules(node[k])) && !result.strategy1_webpack.Qg) {
            result.strategy1_webpack.Qg = { moduleId: id, value: node };
          }
          // Object form of an A/B/C config: 3 keys, values reference group names.
          if (keys.length === 3) {
            const dump = short(node, 1200);
            if ((NAMES.some(n => dump.includes(n)) || /review/i.test(dump))) {
              result.strategy1_webpack.abcCandidates.push({ moduleId: id, kind: 'object3', keys, value: node });
            }
          }
        }

        // Any string mentioning "Review" — the label template lives somewhere.
        if (typeof node === 'string' && /review/i.test(node) && node.length < 40) {
          if (!seenGlobal.has(node)) { seenGlobal.add(node); result.strategy1_webpack.reviewStrings.push({ moduleId: id, value: node }); }
        }
      });
    }
  }

  // ── Strategy 2: React fiber walk for the tracker component ────────────────
  // Find any fiber whose props/state carry an array of length 3 with numeric
  // counts, or that reference the group names. Dump the readable slice.
  function scanFiber() {
    const root = document.querySelector('#root') || document.body;
    if (!root) return;
    const fkey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'));
    if (!fkey) return;
    let fiber = root[fkey];
    if (fiber && fiber.current) fiber = fiber.current; // container → root fiber

    const seen = new Set();
    const stack = [fiber];
    let n = 0;
    while (stack.length && n < 40000) {
      const f = stack.pop();
      if (!f || seen.has(f)) continue;
      seen.add(f); n++;
      for (const bag of [f.memoizedProps, f.memoizedState]) {
        if (!bag || typeof bag !== 'object') continue;
        let dump = '';
        try { dump = JSON.stringify(bag); } catch (_) { continue; }
        if (!dump) continue;
        const mentionsGroups = NAMES.some(name => dump.includes(name));
        const mentionsReview = /review/i.test(dump);
        if (mentionsGroups || mentionsReview) {
          result.strategy2_fiber.hits.push({
            component: (f.type && (f.type.displayName || f.type.name)) || String(f.elementType && (f.elementType.name || f.elementType.displayName) || '?'),
            mentionsGroups, mentionsReview,
            sample: dump.slice(0, 600),
          });
        }
      }
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
    }
    result.strategy2_fiber.hits = result.strategy2_fiber.hits.slice(0, 15);
  }

  // ── Strategy 4: scrape the A/B/C counts off the rendered tracker ──────────
  // (Runs before strategy 3, which consumes it.) Collect elements whose text
  // pairs a letter/"Review" label with a number.
  function scanDom() {
    const out = [];
    const els = document.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.children.length > 3) continue; // leaf-ish only
      const t = (el.textContent || '').trim();
      if (!t || t.length > 40) continue;
      const m = t.match(/\b([ABC])\b[^0-9]{0,12}(\d{1,4})|(\d{1,4})[^0-9]{0,12}\b([ABC])\b|([ABC])[- ]?review[^0-9]{0,12}(\d{1,4})/i);
      if (m) out.push({ text: t, letter: (m[1] || m[4] || m[5] || '').toUpperCase(), num: parseInt(m[2] || m[3] || m[6], 10) });
    }
    // de-dup by text
    const seen = new Set();
    result.strategy4_dom.abcCounts = out.filter(o => { const k = o.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20);
  }

  // ── Strategy 3: arithmetic derivation (self-checking) ─────────────────────
  // If Qg was recovered, classify this half's base events into the 6 groups
  // using the REAL rules, then find the disjoint pairing of group counts that
  // sums to the A/B/C targets. Even without a full classifier, if you know the
  // 6 counts this proves the pairing uniquely.
  function deriveArithmetic() {
    // Targets: prefer scraped DOM counts, else the KNOWN_ABC constant.
    const dom = result.strategy4_dom.abcCounts;
    const byLetter = {};
    dom.forEach(d => { if (d.letter && !byLetter[d.letter]) byLetter[d.letter] = d.num; });
    const targets = (byLetter.A && byLetter.B && byLetter.C)
      ? { A: byLetter.A, B: byLetter.B, C: byLetter.C, source: 'DOM' }
      : { ...KNOWN_ABC, source: 'KNOWN_ABC constant' };
    result.strategy3_arith.abcTargets = targets;

    // We only get here with real per-group counts once the classifier is
    // implemented from Qg (see docs/REVIEW_GROUPS.md). For now, if the caller
    // has stashed counts on window.__MARK_RG_COUNTS__ = {carry:.., ...}, use them.
    const counts = window.__MARK_RG_COUNTS__ || null;
    if (!counts) {
      result.strategy3_arith.note =
        'No per-group counts available yet (classifier not implemented in this ' +
        'diagnostic). The webpack/fiber strategies above give the mapping ' +
        'directly; this arithmetic check activates once Qg-based counts exist.';
      return;
    }
    result.strategy3_arith.perGroup = counts;
    const c = NAMES.map(n => [n, counts[n] || 0]);
    // brute force disjoint pairing of 6 groups into 3 pairs, match to targets
    const T = [targets.A, targets.B, targets.C].sort((a, b) => a - b);
    const idx = [0, 1, 2, 3, 4, 5];
    const pairings = [];
    (function pair(rem, acc) {
      if (!rem.length) { pairings.push(acc.slice()); return; }
      const first = rem[0];
      for (let j = 1; j < rem.length; j++) {
        pair(rem.filter((_, k) => k !== 0 && k !== j), acc.concat([[first, rem[j]]]));
      }
    })(idx, []);
    for (const p of pairings) {
      const sums = p.map(([a, b]) => c[a][1] + c[b][1]).sort((x, y) => x - y);
      if (sums[0] === T[0] && sums[1] === T[1] && sums[2] === T[2]) {
        const mapping = {};
        p.forEach(([a, b]) => {
          const sum = c[a][1] + c[b][1];
          const letter = sum === targets.A ? 'A' : sum === targets.B ? 'B' : 'C';
          mapping[letter + '-Review'] = [c[a][0], c[b][0]];
        });
        result.strategy3_arith.mapping = mapping;
        break;
      }
    }
    if (!result.strategy3_arith.mapping) result.strategy3_arith.note = 'No disjoint pairing matched the targets — check counts/targets.';
  }

  // ── Build the final answer from the strongest available strategy ──────────
  function finalize() {
    let answer = null, basis = null;

    const abc = result.strategy1_webpack.abcCandidates;
    if (abc.length) { answer = abc[0].value; basis = 'strategy1 webpack A/B/C config object (module ' + abc[0].moduleId + ')'; }
    else if (result.strategy3_arith.mapping) { answer = result.strategy3_arith.mapping; basis = 'strategy3 arithmetic derivation'; }
    else if (result.strategy1_webpack.Ug) {
      // Fall back to the pairs hypothesis over the recovered Ug order.
      const u = result.strategy1_webpack.Ug.value.filter(x => NAME_SET.has(x));
      if (u.length === 6) {
        answer = { 'A-Review': [u[0], u[1]], 'B-Review': [u[2], u[3]], 'C-Review': [u[4], u[5]] };
        basis = 'HYPOTHESIS: consecutive pairs over recovered Ug order (verify against tracker counts!)';
      }
    }
    result.finalAnswer = { mapping: answer, basis };
  }

  // ── Run ───────────────────────────────────────────────────────────────────
  try { scanWebpack(); } catch (e) { result.strategy1_webpack.error = String(e); }
  try { scanFiber(); }   catch (e) { result.strategy2_fiber.error = String(e); }
  try { scanDom(); }     catch (e) { result.strategy4_dom.error = String(e); }
  try { deriveArithmetic(); } catch (e) { result.strategy3_arith.error = String(e); }
  try { finalize(); } catch (e) { result.finalizeError = String(e); }

  window.__MARK_RG__ = result;
  console.log('%c=== MARK review-group discovery ===', 'font-weight:bold;font-size:14px');
  console.log('Strategy 1 (webpack values):', result.strategy1_webpack);
  console.log('Strategy 2 (fiber):', result.strategy2_fiber);
  console.log('Strategy 4 (DOM counts):', result.strategy4_dom);
  console.log('Strategy 3 (arithmetic):', result.strategy3_arith);
  console.log('%c=== FINAL ANSWER ===', 'font-weight:bold;font-size:14px;color:#e8500a');
  console.log(result.finalAnswer);
  if (result.strategy1_webpack.Qg) console.log('Recovered Qg (real rules — send this to MARK):', result.strategy1_webpack.Qg.value);
  try { if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(result, null, 2)); console.log('(full result copied to clipboard)'); } catch (_) {}
  console.log('Full result also on  window.__MARK_RG__');
  return result;
})();
