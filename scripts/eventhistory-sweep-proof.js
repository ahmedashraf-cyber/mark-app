/* ───────────────────────────────────────────────────────────────────────────
 * MARK · EventHistory auto-sweep PROOF
 *
 * Paste this whole file into the DevTools console of the LIVE "Tag Once"
 * collection app, on a match that is already loaded, with the collection-app
 * window FOCUSED (foreground). It re-issues the app's own `EventHistory` query
 * for the minimal set of events needed to cover every distinct collector/
 * reviewer of the loaded match — with NO manual card/popover opening — and
 * prints a verdict.
 *
 * It is read-only: it only re-issues a query the app already makes, never
 * writes, never hand-rolls HTTP, never touches the video JWT.
 *
 * What to read in the output:
 *   • socketCloseHits  — how many attempts hit "Socket closed" (the known
 *                        blocker). If > 0 but distinctPeopleFound === authors,
 *                        the retry/backoff is clearing it → fully automatic works.
 *   • queriesRun       — should be small (≈ one per distinct person, deduped).
 *   • unresolved       — should be [] for success.
 *   • the console.table — sample {legacyId, hrcode, name, email}.
 *
 * Full result is left on window.__PROOF_IDS__.
 * ─────────────────────────────────────────────────────────────────────────── */
(async () => {
  const client = window.apollo && window.apollo.client;
  if (!client) { console.error('[proof] window.apollo.client not found — run this in the collection app renderer'); return; }

  // 1) EventHistory DocumentNode (prefer the app's captured one if present).
  const f = (name, args, sel) => ({ kind: 'Field', name: { kind: 'Name', value: name }, arguments: args || [], directives: [], selectionSet: sel || undefined });
  const leaf = ['id','key','capturedTime','eventTime','authorInfo','type','category','payload'].map(n => f(n));
  const DOC = window.__MARK_EH_DOC__ || {
    kind: 'Document',
    definitions: [{
      kind: 'OperationDefinition', operation: 'query', name: { kind: 'Name', value: 'EventHistory' },
      variableDefinitions: [{ kind: 'VariableDefinition',
        variable: { kind: 'Variable', name: { kind: 'Name', value: 'eventKey' } },
        type: { kind: 'NonNullType', type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } } }, directives: [] }],
      directives: [],
      selectionSet: { kind: 'SelectionSet', selections: [
        f('eventHistory', [{ kind: 'Argument', name: { kind: 'Name', value: 'eventKey' }, value: { kind: 'Variable', name: { kind: 'Name', value: 'eventKey' } } }],
          { kind: 'SelectionSet', selections: leaf }) ] },
    }],
  };

  // 2) Distinct authors + one representative eventKey each, from the Apollo cache.
  const cache = client.cache.extract();
  const events = Object.values(cache).filter(v => v && v.__typename === 'Event' && v.key && v.author != null
    && (v.category === 'base' || v.category === 'amendment'));
  events.sort((a, b) => (a.category === 'amendment' ? 0 : 1) - (b.category === 'amendment' ? 0 : 1)); // amendments first
  const keyForId = {}, authors = new Set();
  for (const e of events) { authors.add(String(e.author)); if (!keyForId[String(e.author)]) keyForId[String(e.author)] = e.key; }
  console.log('[proof] cached events:', events.length, '| distinct authors:', authors.size, [...authors]);
  if (!authors.size) { console.warn('[proof] no authored events in cache — open a match first'); return; }
  if (document.hidden) console.warn('[proof] window is BACKGROUNDED — keep it focused or the socket may stay throttled');

  // 3) Harvest authorInfo (note: hrcode is LOWERCASE).
  const ID = new Map();
  const harvest = (data) => {
    let n = 0;
    for (const row of (data && data.eventHistory) || []) {
      const a = row && row.authorInfo; if (!a || a.legacyId == null) continue;
      const name = [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ');
      if (!ID.has(String(a.legacyId))) n++;
      ID.set(String(a.legacyId), { legacyId: a.legacyId, hrcode: a.hrcode, name, email: a.email });
    }
    return n;
  };

  // 4) Robust single query — the crux. Retry "Socket closed"/network errors on
  //    the reconnected socket with backoff.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let totalAttempts = 0, socketCloseHits = 0;
  const isSocketErr = e => {
    const m = ((e && e.message) || '') + ' ' + ((e && e.networkError && (e.networkError.message || e.networkError)) || '');
    return /socket|closed|websocket|connection|network|econn|terminat|1006|going away/i.test(String(m));
  };
  const runRobust = async (eventKey, maxAttempts = 8) => {
    let delay = 400, lastMsg = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      totalAttempts++;
      try {
        const res = await client.query({ query: DOC, variables: { eventKey }, fetchPolicy: 'no-cache', errorPolicy: 'all' });
        const got = harvest(res && res.data);
        return { ok: true, attempt, got };
      } catch (e) {
        lastMsg = ((e && e.message) || '') + (e && e.networkError ? ' | net:' + (e.networkError.message || e.networkError) : '');
        const sock = isSocketErr(e); if (sock) socketCloseHits++;
        console.warn('[proof] attempt ' + attempt + ' failed (' + eventKey.slice(0, 8) + '…):', lastMsg, sock ? '→ retrying on fresh socket' : '');
        if (attempt === maxAttempts) return { ok: false, attempt, err: lastMsg };
        await sleep(delay); delay = Math.min(delay * 2, 4000);
      }
    }
  };

  // 5) Minimal sweep: one query per still-unresolved author; stop early.
  console.log('[proof] starting sweep…');
  const ids = [...authors];
  let queries = 0, consecutiveNoNew = 0; const CAP = 30, STOP = 5;
  for (const id of ids) {
    if (ID.has(id)) continue;                 // already resolved by an earlier query
    const key = keyForId[id]; if (!key) continue;
    const before = ID.size;
    const r = await runRobust(key, queries === 0 ? 10 : 6); // first query warms the socket
    queries++;
    console.log('[proof] query #' + queries + ' (' + key.slice(0, 8) + '…) → ' +
      (r.ok ? ('ok +' + (ID.size - before) + ' on attempt ' + r.attempt) : ('FAILED: ' + r.err)));
    if (ID.size > before) consecutiveNoNew = 0; else consecutiveNoNew++;
    if (queries >= CAP || consecutiveNoNew >= STOP) break;
    await sleep(350);
  }

  // 6) Verdict.
  const people = [...ID.values()];
  const unresolved = ids.filter(id => !ID.has(id));
  console.log('%c[proof] DONE', 'font-weight:bold;color:#0a0', {
    queriesRun: queries,
    totalClientQueryAttempts: totalAttempts,
    socketCloseHits,
    distinctAuthorsInMatch: authors.size,
    distinctPeopleFound: people.length,
    unresolved,
    verdict: unresolved.length === 0 ? 'FULLY AUTOMATIC ✓ (headless EventHistory replay works)' :
             people.length > 0 ? 'PARTIAL — some resolved; see unresolved[]' :
             'BLOCKED — headless replay failed; fallback needed',
  });
  console.table(people.slice(0, 30).map(p => ({ legacyId: p.legacyId, hrcode: p.hrcode, name: p.name, email: p.email })));
  window.__PROOF_IDS__ = people;
  console.log('[proof] full list on window.__PROOF_IDS__');
})();
