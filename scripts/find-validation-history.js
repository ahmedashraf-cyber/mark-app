/* ============================================================================
 * MARK — Tag Once validation error investigation (console-runnable)
 * ----------------------------------------------------------------------------
 * Paste into Tag Once DevTools (F12) with a match/half loaded. Answers three
 * questions in one pass, and cross-checks them:
 *
 *   PART A  Does the SERVER keep validation history?  (GraphQL introspection —
 *           the untried high-value angle. If a validationLogs/resolvedAt-type
 *           query exists, history is recoverable; it auto-runs it.)
 *   PART B  Reproduce the CURRENT errors straight from the Apollo cache — no
 *           window, no click — by replicating the `missing-partials` rule
 *           (required-partials that have no refinement record). Attributed per
 *           author, per category. This is the zero-intervention metric.
 *   PART C  LIVE ground truth: tap the Error Check window's IPC once to read the
 *           real current errors, so PART B can be validated against it.
 *
 * Everything is read-only and reversible. Results are left on
 *   window.__MARK_VAL__   and copied to the clipboard as JSON.
 * ==========================================================================*/
(async function () {
  'use strict';

  const RESULT = { part: {}, matchId: null, partId: null, notes: [] };
  const log = (...a) => console.log('%c[MARK-VAL]', 'color:#e8500a;font-weight:bold', ...a);
  const client = (window.apollo && window.apollo.client) || window.__APOLLO_CLIENT__ || null;
  const cache = client ? client.cache.extract() : null;

  // ── Detect the loaded match / part ────────────────────────────────────────
  (function detectMatch() {
    try {
      const vals = Object.values(cache || {});
      // Prefer a Match object; else infer from the most common event matchId.
      const match = vals.find(v => v && v.__typename === 'Match');
      if (match && match.id != null) RESULT.matchId = typeof match.id === 'string' ? parseInt(match.id, 10) : match.id;
      const partCount = {};
      vals.forEach(v => { if (v && v.__typename === 'Event' && v.partId != null) partCount[v.partId] = (partCount[v.partId] || 0) + 1; });
      RESULT.partId = Object.entries(partCount).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (RESULT.partId != null) RESULT.partId = parseInt(RESULT.partId, 10);
      if (RESULT.matchId == null) {
        const ev = vals.find(v => v && v.__typename === 'Event' && v.matchId != null);
        if (ev) RESULT.matchId = typeof ev.matchId === 'string' ? parseInt(ev.matchId, 10) : ev.matchId;
      }
    } catch (_) {}
    log('match', RESULT.matchId, 'part', RESULT.partId);
  })();

  // ══ PART A — GraphQL schema introspection (server-side history?) ══════════
  function getParse() {
    for (const m of ['graphql-tag', 'graphql']) {
      try {
        const mod = window.require && window.require(m);
        if (mod) {
          if (typeof mod === 'function') return s => mod(s);           // graphql-tag default
          if (mod.parse) return s => mod.parse(s);                     // graphql.parse
          if (mod.default && typeof mod.default === 'function') return s => mod.default(s);
        }
      } catch (_) {}
    }
    if (typeof window.gql === 'function') return s => window.gql(s);
    return null;
  }

  async function partA() {
    const A = RESULT.part.A = { introspectionAvailable: false, validationQueries: [], validationTypes: [], executed: null, error: null };
    if (!client) { A.error = 'window.apollo.client not found'; log('PART A: no Apollo client'); return; }
    const parse = getParse();
    if (!parse) { A.error = 'no GraphQL parser reachable (graphql / graphql-tag / window.gql)'; log('PART A:', A.error); return; }

    const run = async (queryStr) => {
      const res = await client.query({ query: parse(queryStr), fetchPolicy: 'no-cache', errorPolicy: 'all' });
      return res && res.data;
    };
    const RX = /valid|resolv|fix|error|history|log|correct|amend/i;

    // 1) list all root Query fields
    try {
      const d = await run('query MarkIntrospectRoot { __type(name:"Query"){ fields { name args { name } type { kind name ofType { kind name ofType { kind name } } } } } }');
      A.introspectionAvailable = !!(d && d.__type && d.__type.fields);
      if (A.introspectionAvailable) {
        const unwrap = t => { let x = t, name = null; let g = 0; while (x && g++ < 6) { if (x.name) name = x.name; x = x.ofType; } return name; };
        A.validationQueries = d.__type.fields
          .filter(f => RX.test(f.name) || RX.test(unwrap(f.type) || ''))
          .map(f => ({ name: f.name, args: (f.args || []).map(a => a.name), returns: unwrap(f.type) }));
        log('PART A: root query fields matching validation/history:', A.validationQueries);
      }
    } catch (e) {
      A.error = 'introspection failed/disabled: ' + (e && e.message);
      log('PART A:', A.error);
    }

    // 2) introspect the return TYPE of each candidate for resolved/By/At fields
    for (const q of A.validationQueries) {
      if (!q.returns) continue;
      try {
        const d = await run('query MarkIntrospectType { __type(name:' + JSON.stringify(q.returns) + '){ name fields { name type { kind name ofType { name } } } } }');
        if (d && d.__type) A.validationTypes.push({ type: d.__type.name, fields: (d.__type.fields || []).map(f => f.name) });
      } catch (_) {}
    }
    if (A.validationTypes.length) log('PART A: candidate type fields (look for resolvedAt/resolvedBy/status):', A.validationTypes);

    // 3) if a history-looking query takes matchId/partId, auto-run it
    const hist = A.validationQueries.find(q => q.args.some(a => /match/i.test(a)) && /valid|log/i.test(q.name));
    if (hist) {
      try {
        const argParts = [];
        if (hist.args.some(a => /match/i.test(a))) argParts.push((hist.args.find(a => /match/i.test(a))) + ': ' + RESULT.matchId);
        if (hist.args.some(a => /part/i.test(a)) && RESULT.partId != null) argParts.push((hist.args.find(a => /part/i.test(a))) + ': ' + RESULT.partId);
        const typeFields = (A.validationTypes.find(t => t.type === hist.returns) || {}).fields || ['key', 'category', 'eventId'];
        const sel = typeFields.filter(f => /key|categ|event|resolv|status|author|time|part|type|code/i.test(f)).join(' ') || 'key category eventId';
        const q = 'query MarkValHist { ' + hist.name + '(' + argParts.join(', ') + ') { ' + sel + ' } }';
        log('PART A: executing discovered history query →', q);
        A.executed = { query: q, data: await run(q) };
        log('PART A: history query result:', A.executed.data);
      } catch (e) { A.executed = { error: e && e.message }; log('PART A: history query failed:', A.executed.error); }
    }
  }

  // ══ PART B — reproduce current errors from the Apollo cache ════════════════
  // missing-partials: a base event whose payload['required-partials'] names a
  // module that has NO refinement record (same key, type == module). Fully
  // cache-computed → zero intervention, and attributable to the base author.
  function partB() {
    const B = RESULT.part.B = { missingPartials: 0, byCategory: {}, byModule: {}, byAuthor: {}, events: [], note: null };
    if (!cache) { B.note = 'no Apollo cache'; return; }
    const numMatchId = RESULT.matchId, partId = RESULT.partId;
    const inHalf = v => v && v.__typename === 'Event'
      && (numMatchId == null || v.matchId === numMatchId || v.matchId === String(numMatchId))
      && (partId == null || v.partId == null || v.partId === partId);

    // index refinements present per event key: key -> Set(type)
    const partialsByKey = {};
    Object.values(cache).forEach(v => {
      if (inHalf(v) && v.category === 'refinement' && v.key) {
        (partialsByKey[v.key] = partialsByKey[v.key] || new Set()).add(String(v.type).toLowerCase());
      }
    });
    const norm = s => String(s).toLowerCase().replace(/[_\s]+/g, '-');

    const bases = Object.values(cache).filter(v => inHalf(v) && v.category === 'base');
    const seen = new Set();
    bases.forEach(v => {
      if (seen.has(v.key)) return; seen.add(v.key);
      const req = v.payload && (v.payload['required-partials'] || v.payload.requiredPartials);
      if (!Array.isArray(req) || !req.length) return;
      const have = partialsByKey[v.key] || new Set();
      const missing = req.filter(m => !have.has(norm(m)) && !have.has(String(m).toLowerCase()));
      if (missing.length) {
        B.missingPartials += missing.length;
        missing.forEach(m => { B.byModule[m] = (B.byModule[m] || 0) + 1; });
        B.byAuthor[v.author] = (B.byAuthor[v.author] || 0) + missing.length;
        B.events.push({ key: v.key, name: v.payload && v.payload.name, author: v.author, missing });
      }
    });
    B.byCategory['missing-partials'] = B.missingPartials;
    B.events = B.events.slice(0, 50); // cap the dump
    B.note = 'missing-partials computed from cache. invalid-partials / event-sequence / custom-validation are NOT reproduced here (they need the app\'s rule engine — use PART C for those). Compare missing-partials to the Error Check window.';
    log('PART B: cache-computed missing-partials =', B.missingPartials, 'by module:', B.byModule);
  }

  // ══ PART C — live ground truth via a safe (non-recursive) IPC tap ═════════
  async function partC() {
    const C = RESULT.part.C = { fired: false, total: null, byCategory: {}, errors: [] };
    let ipcR; try { ipcR = window.require('electron').ipcRenderer; } catch (_) { C.error = 'ipcRenderer unavailable'; log('PART C:', C.error); return; }
    const origSend = ipcR.__markOrigSend || ipcR.send.bind(ipcR);
    ipcR.__markOrigSend = origSend;
    let errors = null, fired = false;
    ipcR.send = function (channel) {
      try {
        if (channel === 'openValidationWindow') { errors = (arguments[1] && arguments[1].errors) || []; fired = true; }
        if (channel === 'updateValidationList' && arguments[1] && arguments[1].errors) { errors = arguments[1].errors; fired = true; }
        if (channel === 'validationApiResponse' && arguments[1] && arguments[1].currentState === 'loaded')
          setTimeout(() => { if (!fired) errors = []; }, 500);
      } catch (_) {}
      return origSend.apply(ipcR, arguments);
    };
    try {
      const btn = (document.querySelector('span.bp6-icon-error') || {}).parentElement;
      const clickable = btn && (btn.closest('a') || btn.parentElement);
      if (clickable) clickable.click(); else log('PART C: Error Check button not found — skipping live click');
      await new Promise(r => setTimeout(r, 3000));
    } finally {
      try { origSend('closeValidationWindow'); } catch (_) {}
      ipcR.send = origSend;                       // restore immediately (no lingering tap)
    }
    if (errors == null) errors = [];
    C.fired = fired; C.total = errors.length;
    errors.forEach(e => { C.byCategory[e.category] = (C.byCategory[e.category] || 0) + 1; });
    C.errors = errors.slice(0, 50);
    log('PART C: live validation errors =', C.total, C.byCategory);
  }

  // ── Run all three, reconcile ──────────────────────────────────────────────
  await partA();
  partB();
  await partC();

  const liveMissing = (RESULT.part.C.byCategory && RESULT.part.C.byCategory['missing-partials']) || 0;
  RESULT.reconcile = {
    cache_missingPartials: RESULT.part.B.missingPartials,
    live_missingPartials: liveMissing,
    match: RESULT.part.C.total != null ? (RESULT.part.B.missingPartials === liveMissing) : 'live-not-available',
    serverHistory: RESULT.part.A.validationQueries && RESULT.part.A.validationQueries.length
      ? 'candidate queries found — see part.A' : (RESULT.part.A.introspectionAvailable ? 'introspection OK, no validation-history query exposed' : 'introspection unavailable/disabled'),
  };

  window.__MARK_VAL__ = RESULT;
  console.log('%c=== VALIDATION INVESTIGATION SUMMARY ===', 'font-weight:bold;font-size:14px;color:#e8500a');
  console.log('server history (PART A):', RESULT.reconcile.serverHistory);
  console.log('cache missing-partials (PART B):', RESULT.reconcile.cache_missingPartials);
  console.log('live errors (PART C):', RESULT.part.C.total, RESULT.part.C.byCategory);
  console.log('cache vs live missing-partials match:', RESULT.reconcile.match);
  console.log('Full result on window.__MARK_VAL__');
  try { if (navigator.clipboard) { navigator.clipboard.writeText(JSON.stringify(RESULT, null, 2)); console.log('(copied to clipboard)'); } } catch (_) {}
  return RESULT;
})();
