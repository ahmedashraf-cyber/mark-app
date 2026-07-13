(async function(){
  const BRIDGE_VERSION = '7.5.36';
  if(window.__MARK_BRIDGE_VERSION__ === BRIDGE_VERSION){console.log('[MARK] bridge already running (v' + BRIDGE_VERSION + ')');return;}
  if(window.__MARK_BRIDGE_STOP__) window.__MARK_BRIDGE_STOP__();
  window.__MARK_BRIDGE__ = true;
  window.__MARK_BRIDGE_VERSION__ = BRIDGE_VERSION;
  console.log('[MARK] bridge starting (v' + BRIDGE_VERSION + ' — localhost WebSocket)');

  // ── Optional auto-auth tokens (for Firebase session lookup only) ──────────
  const __MARK_FB_API_KEY__ = 'AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U';
  const __MARK_ID_TOKEN__ = '__ID_TOKEN__';
  const __MARK_REFRESH_TOKEN__ = '__REFRESH_TOKEN__';
  const __MARK_UID__ = '__USER_UID__';
  const __MARK_EMAIL__ = '__USER_EMAIL__';

  // Pre-seed Firebase persistence for the session lookup (auth only)
  function seedAuthPersistence(){
    try {
      if (!__MARK_REFRESH_TOKEN__ || __MARK_REFRESH_TOKEN__.startsWith('__')) return false;
      const key = 'firebase:authUser:' + __MARK_FB_API_KEY__ + ':[DEFAULT]';
      const userObj = {
        uid: __MARK_UID__,
        email: __MARK_EMAIL__,
        emailVerified: false,
        isAnonymous: false,
        providerData: [{ providerId: 'password', uid: __MARK_EMAIL__, email: __MARK_EMAIL__ }],
        stsTokenManager: {
          refreshToken: __MARK_REFRESH_TOKEN__,
          accessToken:  __MARK_ID_TOKEN__,
          expirationTime: Date.now() + 3600000
        },
        createdAt: String(Date.now()),
        lastLoginAt: String(Date.now()),
        apiKey: __MARK_FB_API_KEY__,
        appName: '[DEFAULT]'
      };
      localStorage.setItem(key, JSON.stringify(userObj));
      console.log('[MARK] auth persistence seeded for', __MARK_EMAIL__);
      return true;
    } catch(e) {
      console.warn('[MARK] could not seed auth persistence:', e);
      return false;
    }
  }
  seedAuthPersistence();

  if (!document.body) {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }

  // Load Firebase SDKs — used ONLY for session lookup (one read per half)
  const load = src => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
  const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';
  try {
    await load(CDN + '/firebase-app-compat.js');
    await load(CDN + '/firebase-auth-compat.js');
    await load(CDN + '/firebase-firestore-compat.js');
  } catch(e) {
    console.error('[MARK] Firebase load failed:', e);
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp({
    apiKey: __MARK_FB_API_KEY__,
    authDomain: 'hudl-training-ops.firebaseapp.com',
    projectId:  'hudl-training-ops',
    storageBucket: 'hudl-training-ops.appspot.com'
  });
  const auth = firebase.auth();
  const db = firebase.firestore();

  // ── Login panel (fallback for first sign-in on a fresh PC) ────────────────
  const panel = document.createElement('div');
  panel.id = '__mark_panel__';
  Object.assign(panel.style, {
    position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
    background: '#111827', color: '#f9fafb', borderRadius: '12px', padding: '16px',
    fontFamily: 'Inter,system-ui,sans-serif', fontSize: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,.6)', width: '224px',
    border: '1px solid #374151', lineHeight: '1.5', display: 'none'
  });
  document.body.appendChild(panel);
  const $ = id => panel.querySelector('#' + id);
  function showLogin(err) {
    panel.style.display = 'block';
    panel.innerHTML = '<b style="font-size:13px">MARK Bridge</b>' + (err ? '<p style="color:#f87171;margin:6px 0 0;font-size:11px">' + err + '</p>' : '') + '<p style="color:#9ca3af;margin:8px 0 4px;font-size:11px">Sign in with your FIELD account</p><input id="mb_e" type="email" placeholder="Email" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font-size:12px;margin-bottom:6px"><input id="mb_p" type="password" placeholder="Password" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font-size:12px;margin-bottom:10px"><button id="mb_btn" style="width:100%;padding:8px;border:none;border-radius:8px;background:#e8500a;color:#fff;font-weight:700;cursor:pointer;font-size:12px">Sign In</button>';
    const go = () => auth.signInWithEmailAndPassword($('mb_e').value.trim(), $('mb_p').value).catch(e => showLogin(e.message));
    $('mb_btn').onclick = go;
    $('mb_p').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  // ── Event count helper ────────────────────────────────────────────────────
  const EXCLUDED_TYPES = ['starting-xi', 'half-start', 'squad'];
  function countEventsInRange(matchId, startTs, endTs) {
    try {
      // Read from React fiber baseList — this is the exact same list the timeline
      // displays, already filtered and deduplicated by the collection app itself.
      const timelineEl = document.querySelector('[class*="timeline"], [class*="Timeline"], [class*="event-list"], [class*="EventList"]');
      if (!timelineEl) return -1;

      const fiberKey = Object.keys(timelineEl).find(k => k.startsWith('__reactFiber'));
      if (!fiberKey) return -1;

      let fiber = timelineEl[fiberKey];
      let depth = 0;
      while (fiber && depth < 50) {
        const baseList = fiber.memoizedProps?.baseList;
        if (Array.isArray(baseList) && baseList.length > 0 && baseList[0]?.payload?.videoTimestamp !== undefined) {
          return baseList.filter(e =>
            e.payload.videoTimestamp <= endTs &&
            !EXCLUDED_TYPES.includes(e.payload.name)
          ).length;
        }
        fiber = fiber.return;
        depth++;
      }
      return -1;
    } catch(e) {
      console.error('[MARK] countEventsInRange error:', e);
      return -1;
    }
  }

  // ── Identity harvesting (collector/reviewer hrcode + name + email) ─────────
  // The collection app's GraphQL "EventHistory" op returns, for everyone who
  // touched an event, an authorInfo object { legacyId, hrcode (LOWERCASE),
  // firstName, middleName, lastName, email }. legacyId === Event.author. We
  // harvest it (1) PASSIVELY via a tap on the live Apollo link, and (2) ACTIVELY
  // via a sweep that re-issues EventHistory itself so names resolve with no
  // manual "Viewed Event" card opening. Read-only / observational throughout.
  const __ID__ = window.__MARK_IDENTITIES__ = window.__MARK_IDENTITIES__ || new Map();

  function harvestEventHistory(data) {
    let added = 0;
    const rows = (data && data.eventHistory) || [];
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i] && rows[i].authorInfo;
      if (!a || a.legacyId == null) continue;
      const name = [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ');
      const key = String(a.legacyId);
      const prev = __ID__.get(key);
      __ID__.set(key, {
        legacyId: a.legacyId,
        hrcode: a.hrcode || (prev && prev.hrcode) || null,
        name: name || (prev && prev.name) || null,
        email: a.email || (prev && prev.email) || null,
      });
      if (!prev) added++;
    }
    return added;
  }

  function identitiesArray() {
    const out = [];
    __ID__.forEach(function (v) { out.push(v); });
    return out;
  }

  // EventHistory query as a DocumentNode AST — drive the query ourselves with no
  // gql/parse dependency. The passive tap upgrades it to the app's captured
  // DocumentNode (window.__MARK_EH_DOC__) when one is seen, for an exact match.
  let __ehDoc = null;
  function buildEventHistoryDoc() {
    if (window.__MARK_EH_DOC__) return window.__MARK_EH_DOC__;
    if (__ehDoc) return __ehDoc;
    const field = function (name, args, sel) {
      return { kind: 'Field', name: { kind: 'Name', value: name },
        arguments: args || [], directives: [], selectionSet: sel || undefined };
    };
    const leaf = ['id','key','capturedTime','eventTime','authorInfo','type','category','payload']
      .map(function (n) { return field(n); });
    __ehDoc = { kind: 'Document', definitions: [{
      kind: 'OperationDefinition', operation: 'query', name: { kind: 'Name', value: 'EventHistory' },
      variableDefinitions: [{ kind: 'VariableDefinition',
        variable: { kind: 'Variable', name: { kind: 'Name', value: 'eventKey' } },
        type: { kind: 'NonNullType', type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } } }, directives: [] }],
      directives: [],
      selectionSet: { kind: 'SelectionSet', selections: [
        field('eventHistory', [{ kind: 'Argument', name: { kind: 'Name', value: 'eventKey' },
          value: { kind: 'Variable', name: { kind: 'Name', value: 'eventKey' } } }],
          { kind: 'SelectionSet', selections: leaf }) ] },
    }] };
    return __ehDoc;
  }

  // PASSIVE tap on the live Apollo link (client.queryManager.link.request — a
  // concat chain; client.link does NOT route traffic). Harvests every
  // EventHistory response. Reuses the observable's own ctor. Fail-open + reversible.
  function installLinkTap() {
    try {
      const client = window.apollo && window.apollo.client;
      if (!client) return false;
      const qm = client.queryManager || (client.getQueryManager && client.getQueryManager());
      const link = (qm && qm.link) || client.link;
      if (!link || !link.request) return false;
      if (link.__markTapped) return true;
      const origRequest = link.request.bind(link);
      link.__markTapped = true;
      link.request = function (operation, forward) {
        const ob = origRequest(operation, forward);
        try {
          if (!ob || typeof ob.subscribe !== 'function') return ob;
          if (!operation || operation.operationName !== 'EventHistory') return ob;
          const Obs = ob.constructor;
          return new Obs(function (sink) {
            const sub = ob.subscribe({
              next: function (result) {
                try {
                  if (result && result.data) {
                    if (!window.__MARK_EH_DOC__ && operation.query) window.__MARK_EH_DOC__ = operation.query;
                    harvestEventHistory(result.data);
                  }
                } catch (e) {}
                sink.next(result);
              },
              error: function (e) { sink.error(e); },
              complete: function () { sink.complete(); },
            });
            return function () { try { sub.unsubscribe(); } catch (e) {} };
          });
        } catch (e) { return ob; }
      };
      window.__MARK_LINK_RESTORE__ = function () {
        try { link.request = origRequest; link.__markTapped = false; } catch (e) {}
      };
      console.log('[MARK] Apollo identity link tap installed');
      return true;
    } catch (e) { console.warn('[MARK] link tap install failed:', e); return false; }
  }
  (function waitForApollo() {
    if (installLinkTap()) return;
    let tries = 0;
    const iv = setInterval(function () { tries++; if (installLinkTap() || tries > 120) clearInterval(iv); }, 500);
  })();

  // "Socket closed" diagnosis: the app's GraphQL rides a WebSocket Apollo link
  // (graphql-ws) that drops when idle / when the renderer is backgrounded. A
  // query fired into a just-dropped socket rejects; graphql-ws reopens on the
  // next attempt. So retry the same key on the reconnected socket with backoff,
  // and only AUTO-sweep while the page is VISIBLE (below) to dodge bg throttling.
  let __socketCloseHits = 0;
  function isSocketErr(e) {
    const m = ((e && e.message) || '') + ' ' +
      ((e && e.networkError && (e.networkError.message || e.networkError)) || '');
    return /socket|closed|websocket|connection|network|econn|terminat|1006|going away/i.test(String(m));
  }
  async function queryEventHistory(eventKey, maxAttempts) {
    const client = window.apollo && window.apollo.client;
    if (!client) throw new Error('apollo not ready');
    const doc = buildEventHistoryDoc();
    const max = maxAttempts || 6;
    let delay = 400, lastErr = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const res = await client.query({ query: doc, variables: { eventKey: eventKey },
          fetchPolicy: 'no-cache', errorPolicy: 'all' });
        if (res && res.data) harvestEventHistory(res.data);
        return true;
      } catch (e) {
        lastErr = e;
        if (isSocketErr(e)) __socketCloseHits++;       // transient — retry reopens the socket
        if (attempt === max) break;
        await new Promise(function (r) { setTimeout(r, delay); });
        delay = Math.min(delay * 2, 4000);
      }
    }
    console.warn('[MARK] EventHistory failed for ' + eventKey + ' after ' + max + ' attempts:',
      lastErr && (lastErr.message || lastErr));
    return false;
  }

  // ACTIVE sweep: resolve every distinct author of a match without opening cards.
  // Gentle + deduped — one EventHistory returns ~5-7 people, so query one event
  // per still-unresolved author, stop early, hard-cap. Includes refinement events
  // so refinement-heavy collectors (few base events) still get a queryable key.
  let __sweepRunning = false;
  async function sweepMatchIdentities(matchId, partId, wantedIds) {
    if (__sweepRunning) return identitiesArray();
    __sweepRunning = true;
    try {
      const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract();
      if (!cache) return identitiesArray();
      const numMatchId = matchId == null ? null : (typeof matchId === 'string' ? parseInt(matchId, 10) : matchId);
      const events = [];
      const vals = Object.values(cache);
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!v || v.__typename !== 'Event') continue;
        if (numMatchId != null && v.matchId !== numMatchId && v.matchId !== String(numMatchId)) continue;
        if (numMatchId != null && partId != null && v.partId != null && v.partId !== partId) continue;
        if (v.category !== 'base' && v.category !== 'amendment' && v.category !== 'refinement') continue;
        if (v.author == null || !v.key) continue;
        events.push(v);
      }
      const target = new Set();
      for (let i = 0; i < events.length; i++) target.add(String(events[i].author));
      if (wantedIds && wantedIds.length) {
        for (let i = 0; i < wantedIds.length; i++) if (wantedIds[i] != null) target.add(String(wantedIds[i]));
      }
      // amendments first (most people per event), then base, then refinement.
      const rank = function (c) { return c === 'amendment' ? 0 : (c === 'base' ? 1 : 2); };
      events.sort(function (a, b) { return rank(a.category) - rank(b.category); });
      const keyForId = {};
      for (let i = 0; i < events.length; i++) {
        const id = String(events[i].author);
        if (!keyForId[id]) keyForId[id] = events[i].key;
      }
      const ids = Array.from(target);
      let queries = 0, consecutiveNoNew = 0, firstQuery = true;
      const CAP = 30;        // hard ceiling — never blast the whole match
      const STOP_AFTER = 4;  // stop after N consecutive queries that found nobody new
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (__ID__.has(id)) continue;          // already resolved (often by an earlier query)
        const key = keyForId[id];
        if (!key) continue;
        const before = __ID__.size;
        await queryEventHistory(key, firstQuery ? 8 : 5);  // first query warms a cold socket
        firstQuery = false;
        queries++;
        if (__ID__.size > before) consecutiveNoNew = 0; else consecutiveNoNew++;
        if (queries >= CAP || consecutiveNoNew >= STOP_AFTER) break;
        await new Promise(function (r) { setTimeout(r, 350); });   // throttle ~350ms
      }
      console.log('[MARK] identity sweep done: ' + queries + ' queries, ' + __ID__.size +
        ' identities, ' + __socketCloseHits + ' socket-close retries so far');
      return identitiesArray();
    } catch (e) {
      console.warn('[MARK] sweep error:', e);
      return identitiesArray();
    } finally { __sweepRunning = false; }
  }

  // PROACTIVE foreground auto-sweep — makes identity capture happen on its own.
  // While the collection app is VISIBLE (which it is during audit-mode review)
  // and a match has unresolved authors, sweep automatically. By the time the user
  // switches to MARK and clicks Get Results, everyone is already resolved.
  let __lastAutoSweep = 0;
  function unresolvedAuthorCount() {
    try {
      const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract();
      if (!cache) return { total: 0, unresolved: 0 };
      const vals = Object.values(cache);
      const authors = new Set();
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (v && v.__typename === 'Event' && v.author != null &&
            (v.category === 'base' || v.category === 'amendment' || v.category === 'refinement'))
          authors.add(String(v.author));
      }
      let unresolved = 0;
      authors.forEach(function (id) { if (!__ID__.has(id)) unresolved++; });
      return { total: authors.size, unresolved: unresolved };
    } catch (e) { return { total: 0, unresolved: 0 }; }
  }
  async function maybeAutoSweep() {
    if (__sweepRunning) return;
    if (document.hidden) return;                   // foreground only — dodge bg throttling
    if (Date.now() - __lastAutoSweep < 8000) return;
    const stat = unresolvedAuthorCount();
    if (stat.total === 0 || stat.unresolved === 0) return;
    __lastAutoSweep = Date.now();
    console.log('[MARK] auto-sweep: ' + stat.unresolved + '/' + stat.total + ' authors unresolved');
    await sweepMatchIdentities();                   // no matchId → whole loaded match
  }
  setInterval(maybeAutoSweep, 10000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(maybeAutoSweep, 600); });
  window.__MARK_SWEEP__ = function () { return sweepMatchIdentities(); };   // manual trigger for debugging

  // ── localhost WebSocket connection ────────────────────────────────────────
  // All sync commands (navCommand, posSync, seekCommand) arrive here.
  // Firebase is NOT used for sync — zero writes per keypress.
  const WS_PORT = 9001;
  let ws = null;
  let wsConnected = false;

  // Stop hook — called when a newer bridge version injects over this one
  window.__MARK_BRIDGE_STOP__ = function() {
    try { if (ws) ws.close(); } catch(_) {}
    ws = null;
    wsConnected = false;
    if (unsubActiveQuery) { unsubActiveQuery(); unsubActiveQuery = null; }
    try { if (window.__MARK_LINK_RESTORE__) window.__MARK_LINK_RESTORE__(); } catch(_) {}
    console.log('[MARK] old bridge stopped cleanly');
  };

  // The localhost WebSocket connection is INDEPENDENT of any <video>. It must
  // stay alive for the whole bridge lifetime regardless of mode (audit/scout),
  // half, or whether a <video> exists — audit mode often has no video, so the
  // socket must not be gated on video attachment. handleSyncMessage resolves
  // the live <video> itself at message time, so connectWs needs no video ref.
  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket('ws://127.0.0.1:' + WS_PORT);
    ws.onopen = () => {
      wsConnected = true;
      console.log('[MARK] bridge WebSocket connected to localhost:' + WS_PORT);
      // Update panel to show connected
      updatePanelStatus('connected');
    };
    ws.onclose = () => {
      wsConnected = false;
      console.log('[MARK] bridge WebSocket closed — retrying in 2s');
      updatePanelStatus('disconnected');
      setTimeout(connectWs, 2000);
    };
    ws.onerror = () => {
      wsConnected = false;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSyncMessage(msg);
      } catch(e) {
        console.error('[MARK] bad WebSocket message:', e);
      }
    };
  }

  // Tracks last timestamps to ignore duplicate/out-of-order messages
  let lastNav = 0, lastPos = 0, lastSeek = 0;

  function handleSyncMessage(msg, _capturedVideo) {
    // Identity resolution needs no <video> — handle it before the video guard.
    if (msg.type === 'resolveMatchIdentities') {
      (async function () {
        let identities = [], err = null;
        try { identities = await sweepMatchIdentities(msg.matchId, msg.partId, msg.legacyIds); }
        catch (e) { err = e && e.message; identities = identitiesArray(); }
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'identitiesResponse', identities: identities,
            error: err, bridgeVersion: BRIDGE_VERSION, reqTs: msg.ts, ts: Date.now() }));
        }
      })();
      return;
    }

    // The collection app destroys and recreates its <video> element when you
    // switch halves, so a reference captured when the socket first connected
    // goes stale and sync silently dies. Always resolve the LIVE video element
    // at message time: prefer the attached one if it's still in the DOM, else
    // fall back to whatever <video> is currently on the page (the poll below
    // will formally re-attach it within ~1s).
    const video = (attachedVideo && attachedVideo.isConnected)
      ? attachedVideo
      : document.querySelector('video');
    if (!video) return;

    if (msg.type === 'navCommand' && msg.ts > lastNav) {
      lastNav = msg.ts;
      const step = msg.shift ? 0.04 : 0.4;
      if (msg.action === 'forward')       video.currentTime = Math.max(0, video.currentTime + step);
      else if (msg.action === 'backward') video.currentTime = Math.max(0, video.currentTime - step);
    }

    else if (msg.type === 'seekCommand' && msg.ts > lastSeek) {
      lastSeek = msg.ts;
      video.currentTime = msg.currentTime;
    }

    else if (msg.type === 'posSync' && msg.ts > lastPos) {
      lastPos = msg.ts;
      // Match play/pause state.
      if (msg.playing && video.paused) { try { const p = video.play(); if (p && p.catch) p.catch(()=>{}); } catch(_){} }
      else if (!msg.playing && !video.paused) video.pause();

      // Smooth follower sync. A hard `currentTime =` on a PLAYING video forces a
      // decoder flush → stutter/dropped frames, and on a busy machine the follower
      // keeps drifting past the threshold and gets seeked every second (stutter
      // loop). Instead, nudge playbackRate to converge invisibly (the follower is
      // muted, so a speed change has no audio artifact). Hard-seek only for big
      // jumps where a nudge would take too long, and exact-align only while paused
      // (a seek while paused has nothing to stutter).
      const DEAD_BAND = 0.18;   // s — within this, treat as in-sync
      const HARD_SEEK = 3.0;    // s — beyond this, one seek is better than nudging
      const diff = msg.currentTime - video.currentTime; // + => follower is behind
      const drift = Math.abs(diff);

      if (!msg.playing) {
        if (drift > 0.05) video.currentTime = msg.currentTime;
        if (video.playbackRate !== 1) video.playbackRate = 1;
      } else if (drift > HARD_SEEK) {
        video.currentTime = msg.currentTime;
        if (video.playbackRate !== 1) video.playbackRate = 1;
      } else if (drift > DEAD_BAND) {
        // Tiered nudge: gentle for small drift, stronger (still smooth) for larger.
        const rate = drift > 0.75 ? 0.85 : 0.95;
        video.playbackRate = diff > 0 ? (2 - rate) : rate; // behind → faster, ahead → slower
      } else if (video.playbackRate !== 1) {
        video.playbackRate = 1;
      }
    }

    else if (msg.type === 'eventCountRequest') {
      const count = countEventsInRange(msg.matchId, msg.startTs, msg.endTs);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'eventCountResponse', count, ts: Date.now() }));
      }
    }

    else if (msg.type === 'getVideoTimeRequest') {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getVideoTimeResponse', time: video.currentTime, ts: Date.now() }));
      }
    }

    else if (msg.type === 'getQAResults') {
      // QA Audit mode — refresh the cache from the server FIRST (it's a stale snapshot;
      // live reviewer edits only re-enter Apollo on a fetch), wait, then read & score.
      (async () => {
        try {
          const ac = window.apollo && window.apollo.client;
          if (ac && typeof ac.refetchQueries === 'function') await ac.refetchQueries({ include: 'active' });
          else if (ac && typeof ac.reFetchObservableQueries === 'function') await ac.reFetchObservableQueries();
        } catch (refErr) {
          console.warn('[MARK] QA refetch failed, using cached data:', refErr && refErr.message);
        }
        await new Promise(r => setTimeout(r, 3000));
      try {
        const endTs = video.currentTime * 1000; // ms
        const matchId = msg.matchId;
        const partId = msg.partId || null; // 1 = first half, 2 = second half
        const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract();
        if (!cache) {
          ws.send(JSON.stringify({ type: 'qaResultsResponse', error: 'Apollo cache not available', ts: Date.now() }));
          return;
        }

        const numMatchId = typeof matchId === 'string' ? parseInt(matchId) : matchId;
        const EXCLUDED = ['starting-xi', 'half-start', 'squad'];

        // ── Method 1: Telemetry-based (primary — EXACT opened events) ─────────
        // Reviewers = "Viewed Event" authors (event-activation telemetry), minus
        // the main collector. Reviewed events = the exact distinct events those
        // reviewers OPENED (telemetry key === base key). No fuzzy time-matching.
        let baseEvents = [];
        let usedTelemetry = false;
        let reviewerIds = [];
        let collectorIdNum = null;

        // All base events in this half (the universe)
        const seenUniverse = new Set();
        const allBase = Object.values(cache).filter(v => {
          if (v.__typename !== 'Event') return false;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return false;
          if (v.category !== 'base') return false;
          if (!v.payload || typeof v.payload.videoTimestamp !== 'number') return false;
          if (v.payload.videoTimestamp <= 0) return false;
          if (EXCLUDED.includes(v.payload.name)) return false;
          if (partId && v.partId !== partId) return false;
          if (seenUniverse.has(v.key)) return false;
          seenUniverse.add(v.key);
          return true;
        });
        const universeKeys = new Set(allBase.map(v => v.key));

        // Per-author tallies for THIS half: base, refinement, amendment, views.
        const baseAuthorCounts = {};
        allBase.forEach(v => { baseAuthorCounts[v.author] = (baseAuthorCounts[v.author] || 0) + 1; });
        const refinementCounts = {}, amendmentCounts = {}, viewCounts = {};
        Object.values(cache).forEach(v => {
          if (!v || v.__typename !== 'Event') return;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return;
          if (partId && v.partId !== partId) return;
          if (v.category === 'refinement') refinementCounts[v.author] = (refinementCounts[v.author] || 0) + 1;
          else if (v.category === 'amendment') amendmentCounts[v.author] = (amendmentCounts[v.author] || 0) + 1;
          else if (v.category === 'telemetry' && v.type === 'event-activation') viewCounts[v.author] = (viewCounts[v.author] || 0) + 1;
        });
        const changeCounts = amendmentCounts;   // amendments = changes
        const topBase = Object.entries(baseAuthorCounts).sort((a,b) => b[1]-a[1])[0]?.[0];

        // ── COLLECTOR(S) — Update #1 ──────────────────────────────────────────
        // A collector PRODUCES data and never "views": views === 0 AND
        // (base + refinement) > 600 in this half. There can be MULTIPLE per half
        // (work is often split by module). Fallback to the top base author when
        // the threshold finds nobody, so scoring always has a collector.
        const COLLECTOR_WORK_MIN = 600;
        const allAuthors = new Set();
        [baseAuthorCounts, refinementCounts, amendmentCounts, viewCounts].forEach(m =>
          Object.keys(m).forEach(k => allAuthors.add(parseInt(k))));
        let collectorIds = [...allAuthors].filter(a =>
          (viewCounts[a] || 0) === 0 &&
          ((baseAuthorCounts[a] || 0) + (refinementCounts[a] || 0)) > COLLECTOR_WORK_MIN
        );
        if (collectorIds.length === 0 && topBase != null) collectorIds = [parseInt(topBase)];
        const collectorSet = new Set(collectorIds);
        collectorIdNum = collectorIds.length ? collectorIds[0] : null;   // primary (back-compat)

        // A reviewer must have made >=1 change — Rule 3: a Viewed-Event author
        // with zero edits/adds is a playthrough, NOT a reviewer. For a
        // non-collector, authoring a base event = an added/missed event = a change.
        const hasChange = a => (changeCounts[a] || 0) > 0 || (baseAuthorCounts[a] || 0) > 0;

        try {
          const telemetryAll = Object.values(cache).filter(v =>
            v.__typename === 'Event' && v.category === 'telemetry' &&
            (v.matchId === numMatchId || v.matchId === String(numMatchId)) &&
            v.type === 'event-activation' && (!partId || v.partId === partId)
          );

          // ── REVIEWER(S) — Update #1 ─────────────────────────────────────────
          // KEY FIX: the reviewer signal is VIEWS (event-activation), NOT
          // amendments. Reviewers = distinct view authors, MINUS all collectors,
          // who also made >=1 change. (Many amendments + 0 views = collector/refiner,
          // not a reviewer.) Playthrough viewers (0 changes) are dropped.
          reviewerIds = [...new Set(telemetryAll.map(t => t.author))]
            .filter(a => !collectorSet.has(a) && hasChange(a));
          const reviewerSet = new Set(reviewerIds);

          // Reviewed events = distinct base events a reviewer OPENED (telemetry key === base key)
          const openedKeys = new Set(
            telemetryAll.filter(t => reviewerSet.has(t.author) && universeKeys.has(t.key)).map(t => t.key)
          );

          baseEvents = allBase.filter(v => openedKeys.has(v.key)).map(v => ({
            id: v.id, key: v.key, name: v.payload.name,
            videoTimestamp: v.payload.videoTimestamp,
            teamId: v.payload.teamId, author: v.author,
            capturedTime: v.capturedTime,
          }));

          if (baseEvents.length > 0) usedTelemetry = true;
        } catch(telErr) {
          console.warn('[MARK] telemetry method failed:', telErr);
        }

        // ── Method 2: Video time fallback (if telemetry unavailable) ─────────
        if (!usedTelemetry) {
          console.log('[MARK] using video time fallback for event counting');
          const seenBase = new Set();
          baseEvents = Object.values(cache).filter(v => {
            if (v.__typename !== 'Event') return false;
            if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return false;
            if (v.category !== 'base') return false;
            if (!v.payload || typeof v.payload.videoTimestamp !== 'number') return false;
            if (v.payload.videoTimestamp <= 0 || v.payload.videoTimestamp > endTs) return false;
            if (EXCLUDED.includes(v.payload.name)) return false;
            if (partId && v.partId !== partId) return false;
            if (seenBase.has(v.key)) return false;
            seenBase.add(v.key);
            return true;
          }).map(v => ({
            id: v.id, key: v.key, name: v.payload.name,
            videoTimestamp: v.payload.videoTimestamp,
            teamId: v.payload.teamId, author: v.author,
            capturedTime: v.capturedTime,
          }));
        }

        // ── Amendments for reviewed events only ───────────────────────────────
        const baseKeysInRange = new Set(baseEvents.map(e => e.key));
        const amendments = Object.values(cache).filter(v => {
          if (v.__typename !== 'Event') return false;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return false;
          if (v.category !== 'amendment') return false;
          if (partId && v.partId !== partId) return false;
          if (!baseKeysInRange.has(v.key)) return false;
          return true;
        }).map(v => ({
          id: v.id, key: v.key, type: v.type, author: v.author,
          capturedTime: v.capturedTime, payload: v.payload,
          originalName: null,
        }));

        // Resolve original event name for each amendment
        const baseByKey = {};
        baseEvents.forEach(e => { baseByKey[e.key] = e; });
        amendments.forEach(a => {
          if (baseByKey[a.key]) a.originalName = baseByKey[a.key].name;
        });

        // collectorIdNum (top base author) and reviewerIds (Viewed-Event telemetry
        // authors minus the collector) were computed in Method 1. Here we add a
        // no-telemetry fallback and build the read-only diagnostics so the picks
        // can be verified by eye.
        const collectorId = collectorIdNum != null ? String(collectorIdNum) : null;

        const toMs = (c) => {
          if (c == null) return 0;
          const n = Number(c); if (!isNaN(n) && n > 0) return n;
          const d = new Date(c).getTime(); return isNaN(d) ? 0 : d;
        };

        // Telemetry breakdown per author (views + first view time) for diagnostics
        const telemetryEvents = Object.values(cache).filter(v =>
          v.__typename === 'Event' && v.category === 'telemetry' &&
          (v.matchId === numMatchId || v.matchId === String(numMatchId)) &&
          v.type === 'event-activation' && (!partId || v.partId === partId)
        );
        const telByAuthor = {};
        telemetryEvents.forEach(t => {
          const ts = toMs(t.capturedTime);
          if (!telByAuthor[t.author]) telByAuthor[t.author] = { author: t.author, views: 0, firstTs: ts || Infinity };
          telByAuthor[t.author].views++;
          if (ts && ts < telByAuthor[t.author].firstTs) telByAuthor[t.author].firstTs = ts;
        });
        const telSorted = Object.values(telByAuthor).sort((x,y) => x.firstTs - y.firstTs);

        let reviewerMethod = reviewerIds.length ? 'viewed-event' : 'none';
        // Fallback (no telemetry at all): most frequent editor who is not a collector.
        if (reviewerIds.length === 0) {
          const reviewerCounts = {};
          amendments.forEach(a => { if (!collectorSet.has(a.author)) reviewerCounts[a.author] = (reviewerCounts[a.author]||0)+1; });
          const top = Object.entries(reviewerCounts).sort((a,b) => b[1]-a[1])[0]?.[0];
          if (top != null) { reviewerIds = [parseInt(top)]; reviewerMethod = 'fallback-freq'; }
        }
        const reviewerId = reviewerIds.length ? reviewerIds[0] : null; // primary, for display/back-compat

        // Diagnostics (read-only) so the picks can be verified by eye.
        const amendAuthorCounts = {};
        amendments.forEach(a => { amendAuthorCounts[a.author] = (amendAuthorCounts[a.author]||0)+1; });
        const diagnostics = {
          reviewerMethod,
          reviewerIds,
          collectorIds,
          universeBase:     allBase.length,
          reviewed:         baseEvents.length,
          telemetry:        telSorted.map(t => ({ author: t.author, views: t.views, firstTs: (t.firstTs === Infinity ? 0 : t.firstTs) })),
          amendmentAuthors: Object.entries(amendAuthorCounts).map(([author,count]) => ({ author: parseInt(author), count })),
          baseAuthors:      Object.entries(baseAuthorCounts).map(([author,count]) => ({ author: parseInt(author), count })),
          // Per-author work profile (base+refinement+amendment+views) so the
          // collector/reviewer picks can be verified by eye.
          work: [...allAuthors].map(a => ({ author: a,
            base: baseAuthorCounts[a]||0, refinement: refinementCounts[a]||0,
            amendment: amendmentCounts[a]||0, views: viewCounts[a]||0 })),
        };

        // ── Per-module scores (Update: module-level quality) ──────────────────
        // Validated method: for each module, denominator = events the reviewer(s)
        // VIEWED (telemetry/event-activation) that have that module; errors =
        // those the reviewer CHANGED in that module. Score = clean % (higher=better).
        //  • base     = viewed base events that are NOT pressure-start/end
        //  • pressure = viewed base events named pressure-start/pressure-end
        //  • players/location/extras/freeze-frame = viewed events with a refinement of that type
        //  • errors: amendment of that type → that module; deletion/base amendment → base or
        //    pressure (by the event's name); a reviewer-authored base event (added/missed) → base/pressure only.
        //  • deletions are kept in the denominator; added events are counted.
        let moduleScores = null;
        try {
          const reviewerSetM = new Set((reviewerIds || []).map(Number));
          const PRESSURE_NAMES = new Set(['pressure-start', 'pressure-end']);
          const PARTIALS = ['players', 'location', 'extras', 'freeze-frame'];
          const inHalf = v => v.__typename === 'Event'
            && (v.matchId === numMatchId || v.matchId === String(numMatchId))
            && (!partId || v.partId === partId);

          // base record per key (for name lookup / pressure classification)
          const baseRecByKey = {};
          Object.values(cache).forEach(v => { if (inHalf(v) && v.category === 'base') baseRecByKey[v.key] = v; });
          const isPressureKey = k => PRESSURE_NAMES.has(baseRecByKey[k] && baseRecByKey[k].payload && baseRecByKey[k].payload.name);

          // reviewer-viewed event keys (the denominator universe)
          const viewedKeysM = new Set();
          Object.values(cache).forEach(v => {
            if (inHalf(v) && v.category === 'telemetry' && v.type === 'event-activation' && reviewerSetM.has(Number(v.author)))
              viewedKeysM.add(v.key);
          });

          // which viewed keys HAVE each partial (a refinement record of that type exists)
          const hasPartial = {}; PARTIALS.forEach(m => hasPartial[m] = new Set());
          Object.values(cache).forEach(v => {
            if (inHalf(v) && v.category === 'refinement' && hasPartial[v.type]) hasPartial[v.type].add(v.key);
          });

          // errors by module from reviewer amendments + reviewer-added base events
          const errM = { base: new Set(), pressure: new Set(), players: new Set(), location: new Set(), extras: new Set(), 'freeze-frame': new Set() };
          Object.values(cache).forEach(v => {
            if (!inHalf(v) || v.category !== 'amendment' || !reviewerSetM.has(Number(v.author))) return;
            if (v.type === 'deletion' || v.type === 'base') { (isPressureKey(v.key) ? errM.pressure : errM.base).add(v.key); }
            else if (errM[v.type]) errM[v.type].add(v.key);
          });
          Object.values(cache).forEach(v => {            // added/missed = reviewer-authored base → base/pressure only
            if (inHalf(v) && v.category === 'base' && reviewerSetM.has(Number(v.author)))
              (isPressureKey(v.key) ? errM.pressure : errM.base).add(v.key);
          });

          const viewedArr = [...viewedKeysM];
          const mk = (denomKeys, errSet) => {
            const total = denomKeys.length;
            const errors = denomKeys.filter(k => errSet.has(k)).length;
            return { total, errors, score: total ? Math.round(((total - errors) / total) * 1000) / 10 : null };
          };

          const baseDenom = viewedArr.filter(k => baseRecByKey[k] && !isPressureKey(k));
          const presDenom = viewedArr.filter(k => isPressureKey(k));
          moduleScores = {
            base:     mk(baseDenom, errM.base),
            pressure: mk(presDenom, errM.pressure),
          };
          PARTIALS.forEach(m => { moduleScores[m] = mk(viewedArr.filter(k => hasPartial[m].has(k)), errM[m]); });
        } catch (msErr) {
          console.warn('[MARK] moduleScores failed:', msErr && msErr.message);
          moduleScores = null;
        }

        // ── Lineup players (home + away with team info) ───────────────────────
        // Used by MARK to resolve player names/jersey numbers in amendments
        let lineupPlayers = [];
        try {
          const matchObj = Object.values(cache).find(function(v) { return v.__typename === 'Match'; });
          const resolveRef = function(ref) { return ref && ref.__ref ? cache[ref.__ref] : ref; };
          const homeTeam = resolveRef(matchObj && matchObj.home);
          const awayTeam = resolveRef(matchObj && matchObj.away);
          [{ team: homeTeam, side: 'home' }, { team: awayTeam, side: 'away' }].forEach(function(t) {
            if (!t.team || !t.team.players) return;
            t.team.players.forEach(function(ref) {
              const p = resolveRef(ref);
              if (!p || !p.id) return;
              lineupPlayers.push({
                id: p.id,
                name: p.name || '',
                nickname: p.nickname || '',
                jersey: p.jersey_number,
                teamId: t.team.id,
                teamName: t.team.name || '',
                side: t.side,
              });
            });
          });
        } catch(lpErr) {
          console.warn('[MARK] lineupPlayers failed:', lpErr && lpErr.message);
          lineupPlayers = [];
        }

        // ── Refinements for reviewed events ──────────────────────────────────
        // Collect all refinements (extras, location, players, freeze-frame, etc.)
        // for the base events in range. Sent as { key_type: payload } map so
        // MARK can show Before/After without needing the Apollo cache on the MARK side.
        const refinements = {};
        Object.values(cache).forEach(function(v) {
          if (v.__typename !== 'Event') return;
          if (v.category !== 'refinement') return;
          if (!baseKeysInRange.has(v.key)) return;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return;
          refinements[v.key + '_' + v.type] = v.payload || {};
        });

        ws.send(JSON.stringify({
          type: 'qaResultsResponse',
          matchId: numMatchId,
          bridgeVersion: BRIDGE_VERSION,
          videoTime: video.currentTime,
          baseEvents,
          amendments,
          refinements,
          collectorId,
          collectorIds,
          reviewerId,
          reviewerIds,
          identities: identitiesArray(),
          lineupPlayers,
          moduleScores,
          diagnostics,
          usedTelemetry,
          environment: (typeof process !== 'undefined' && process.env && process.env.LIVE_COLLECTION_SERVICE_URL)
            ? (process.env.LIVE_COLLECTION_SERVICE_URL.includes('staging') ? 'staging' : 'production')
            : 'production',
          ts: Date.now(),
        }));

      } catch(e) {
        console.error('[MARK] getQAResults error:', e);
        ws.send(JSON.stringify({ type: 'qaResultsResponse', error: e.message, ts: Date.now() }));
      }
      })();
    }
  }

  // ── Status panel (replaces old Firebase-connected panel) ─────────────────
  function updatePanelStatus(status) {
    if (panel.style.display === 'none') return; // don't show if auth is done
    const dot = panel.querySelector('#ws_dot');
    const label = panel.querySelector('#ws_label');
    if (!dot || !label) return;
    if (status === 'connected') {
      dot.style.background = '#30D158';
      label.textContent = 'Sync connected';
    } else {
      dot.style.background = '#FF453A';
      label.textContent = 'Sync disconnected';
    }
  }

  // ── Session listener (Firebase — ONE read per half to find session) ────────
  let attachedVideo = null;
  let unsubActiveQuery = null;
  let currentSid = null;

  function attachVideo(video, user) {
    if (attachedVideo === video) return;
    attachedVideo = video;
    video.muted = true;
    video.addEventListener('volumechange', () => { if (!video.muted) video.muted = true; });
    console.log('[MARK] video attached');

    // NOTE: the localhost WebSocket is connected independently on auth-ready
    // (see onAuthStateChanged below), NOT here — so the bridge stays connected
    // in audit mode and across half/mode switches even when no <video> exists.

    if (unsubActiveQuery) unsubActiveQuery();

    // ONE Firestore query to find the active session — then we're done with Firebase for sync
    unsubActiveQuery = db.collection('mark_sessions')
      .where('reviewerId', '==', user.uid)
      .onSnapshot(snap => {
        let best = null;
        let bestMillis = 0;
        snap.docs.forEach(doc => {
          const d = doc.data();
          if (d.status !== 'in_progress') return;
          const ms = (d.startedAt && d.startedAt.toMillis) ? d.startedAt.toMillis() : 0;
          if (ms >= bestMillis) { best = doc; bestMillis = ms; }
        });

        if (!best) {
          currentSid = null;
          return;
        }
        if (best.id === currentSid) return;
        currentSid = best.id;
        console.log('[MARK] connected to session', currentSid);
        // Session found — WebSocket already connected, sync is live
      }, e => console.error('[MARK] active session query error:', e));
  }

  // Poll for the video element
  setInterval(() => {
    if (!auth.currentUser) return;
    // Keep the localhost socket alive regardless of mode/video (no-op if already
    // open/connecting thanks to the guard inside connectWs).
    connectWs();
    const v = document.querySelector('video');
    if (v && v !== attachedVideo) attachVideo(v, auth.currentUser);
  }, 1000);

  // Auth state observer
  auth.onAuthStateChanged(u => {
    if (u) {
      console.log('[MARK] auth ready as', u.email);
      panel.style.display = 'none';
      // Connect the localhost WebSocket as soon as we're authenticated — this is
      // independent of video, so the bridge stays connected in audit mode and
      // across half/mode switches (Audit ↔ Scout) with no logout/login needed.
      connectWs();
      const v = document.querySelector('video');
      if (v) attachVideo(v, u);
    } else {
      showLogin();
    }
  });
})();
