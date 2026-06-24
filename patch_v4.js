const fs = require('fs');

const collAsar = 'C:\\Users\\AhmedAshraf\\AppData\\Local\\Programs\\live-collection-app\\resources\\app.asar';
const backupPath = collAsar + '.markbackup_v4';

const NEW_BRIDGE = `(async function(){
  const BRIDGE_VERSION = '6.2.0-ids';
  if(window.__MARK_BRIDGE_VERSION__ === BRIDGE_VERSION){console.log('[MARK] bridge already running (v' + BRIDGE_VERSION + ')');return;}
  if(window.__MARK_BRIDGE_STOP__) window.__MARK_BRIDGE_STOP__();
  window.__MARK_BRIDGE__ = true;
  window.__MARK_BRIDGE_VERSION__ = BRIDGE_VERSION;
  console.log('[MARK] bridge starting (v' + BRIDGE_VERSION + ' — localhost WebSocket + identity harvest)');

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
  // The collection app's GraphQL "EventHistory" operation returns, for every
  // person who touched an event, an authorInfo object:
  //   { id, email, firstName, middleName, lastName, hrcode, legacyId }
  // legacyId === Event.author (the numeric id MARK already uses). We harvest it
  // two ways: (1) a PASSIVE tap on the live Apollo link (zero extra requests),
  // and (2) an ACTIVE sweep that re-issues EventHistory ourselves so identities
  // resolve automatically — no need for the user to open each "Viewed Event"
  // popover one by one. Everything here is read-only / observational.
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
      const next = {
        legacyId: a.legacyId,
        hrcode: a.hrcode || (prev && prev.hrcode) || null,
        name: name || (prev && prev.name) || null,
        email: a.email || (prev && prev.email) || null,
      };
      __ID__.set(key, next);
      if (!prev) added++;
    }
    return added;
  }

  function identitiesArray() {
    const out = [];
    __ID__.forEach(function (v) { out.push(v); });
    return out;
  }

  // EventHistory query as a DocumentNode AST — lets us drive the query ourselves
  // with NO dependency on gql/parse being exposed in the renderer. This mirrors
  // the app's own operation verbatim. The passive tap may later replace it with
  // the captured DocumentNode (window.__MARK_EH_DOC__) for an exact match.
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
    __ehDoc = {
      kind: 'Document',
      definitions: [{
        kind: 'OperationDefinition', operation: 'query',
        name: { kind: 'Name', value: 'EventHistory' },
        variableDefinitions: [{
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'eventKey' } },
          type: { kind: 'NonNullType', type: { kind: 'NamedType', name: { kind: 'Name', value: 'String' } } },
          directives: [],
        }],
        directives: [],
        selectionSet: { kind: 'SelectionSet', selections: [
          field('eventHistory',
            [{ kind: 'Argument', name: { kind: 'Name', value: 'eventKey' },
               value: { kind: 'Variable', name: { kind: 'Name', value: 'eventKey' } } }],
            { kind: 'SelectionSet', selections: leaf })
        ] },
      }],
    };
    return __ehDoc;
  }

  // PASSIVE tap: wrap the live Apollo link (client.queryManager.link.request)
  // and harvest every EventHistory response that flows through it. Reuses the
  // observable's own constructor (zen-observable). Fail-open + reversible.
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
                    const n = harvestEventHistory(result.data);
                    if (n) console.log('[MARK] +' + n + ' identities (passive), total ' + __ID__.size);
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

  // Poll until Apollo + its link exist (the bridge starts before the app fully
  // boots), then install the tap once.
  (function waitForApollo() {
    if (installLinkTap()) return;
    let tries = 0;
    const iv = setInterval(function () {
      tries++;
      if (installLinkTap() || tries > 120) clearInterval(iv);
    }, 500);
  })();

  // Re-issue ONE EventHistory query via the app's own client/transport, with
  // retry + backoff. The app routes operations over a WebSocket-based link that
  // can report "Socket closed" when idle/backgrounded; a fresh attempt makes the
  // link reconnect, so a couple of retries clears it. no-cache = network fetch
  // that never reads/writes the app's cache (pure observation).
  async function queryEventHistory(eventKey) {
    const client = window.apollo && window.apollo.client;
    if (!client) throw new Error('apollo not ready');
    const doc = buildEventHistoryDoc();
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await client.query({ query: doc, variables: { eventKey: eventKey },
          fetchPolicy: 'no-cache', errorPolicy: 'all' });
        if (res && res.data) harvestEventHistory(res.data);
        return true;
      } catch (e) {
        lastErr = e;
        await new Promise(function (r) { setTimeout(r, 600 * Math.pow(2, attempt)); });
      }
    }
    console.warn('[MARK] EventHistory failed for', eventKey, lastErr && lastErr.message);
    return false;
  }

  // ACTIVE sweep: resolve EVERY distinct author for a match WITHOUT opening any
  // popover. Gentle + deduped — one EventHistory query returns authorInfo for
  // all ~5-7 people who touched that event, so a handful of queries covers the
  // whole match. Hard caps + a "no new id" stop condition keep it from ever
  // blasting all 1300+ events.
  let __sweepRunning = false;
  async function sweepMatchIdentities(matchId, partId, wantedIds) {
    if (__sweepRunning) return identitiesArray();
    __sweepRunning = true;
    try {
      const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract();
      if (!cache) return identitiesArray();
      const numMatchId = typeof matchId === 'string' ? parseInt(matchId, 10) : matchId;
      const events = [];
      const vals = Object.values(cache);
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!v || v.__typename !== 'Event') continue;
        if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) continue;
        if (partId != null && v.partId != null && v.partId !== partId) continue;
        if (v.category !== 'base' && v.category !== 'amendment') continue;
        if (v.author == null || !v.key) continue;
        events.push(v);
      }
      // Target = everyone who authored anything (+ any ids MARK explicitly asks for).
      const target = new Set();
      for (let i = 0; i < events.length; i++) target.add(String(events[i].author));
      if (wantedIds && wantedIds.length) {
        for (let i = 0; i < wantedIds.length; i++) {
          if (wantedIds[i] != null) target.add(String(wantedIds[i]));
        }
      }
      // One representative event key per author (amendments first — they carry
      // the most distinct people, e.g. collector + every reviewer of that event).
      events.sort(function (a, b) {
        return (a.category === 'amendment' ? 0 : 1) - (b.category === 'amendment' ? 0 : 1);
      });
      const keyForId = {};
      for (let i = 0; i < events.length; i++) {
        const id = String(events[i].author);
        if (!keyForId[id]) keyForId[id] = events[i].key;
      }
      const ids = Array.from(target);
      let queries = 0, consecutiveNoNew = 0;
      const CAP = 30;        // hard ceiling — never blast the whole match
      const STOP_AFTER = 4;  // stop after N consecutive queries that found nobody new
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (__ID__.has(id)) continue;          // already resolved (often by an earlier query)
        const key = keyForId[id];
        if (!key) continue;
        const before = __ID__.size;
        await queryEventHistory(key);
        queries++;
        if (__ID__.size > before) consecutiveNoNew = 0; else consecutiveNoNew++;
        if (queries >= CAP || consecutiveNoNew >= STOP_AFTER) break;
        await new Promise(function (r) { setTimeout(r, 350); });   // throttle ~350ms
      }
      console.log('[MARK] identity sweep done: ' + queries + ' queries, ' + __ID__.size + ' total identities');
      return identitiesArray();
    } catch (e) {
      console.warn('[MARK] sweep error:', e);
      return identitiesArray();
    } finally { __sweepRunning = false; }
  }

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

  function connectWs(video) {
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
      setTimeout(() => connectWs(video), 2000);
    };
    ws.onerror = () => {
      wsConnected = false;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSyncMessage(msg, video);
      } catch(e) {
        console.error('[MARK] bad WebSocket message:', e);
      }
    };
  }

  // Tracks last timestamps to ignore duplicate/out-of-order messages
  let lastNav = 0, lastPos = 0, lastSeek = 0;

  function handleSyncMessage(msg, video) {
    // Identity resolution does NOT need the video element — handle it first.
    if (msg.type === 'resolveMatchIdentities') {
      (async function () {
        let identities = [];
        let err = null;
        try {
          identities = await sweepMatchIdentities(msg.matchId, msg.partId, msg.legacyIds);
        } catch (e) { err = e && e.message; identities = identitiesArray(); }
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'identitiesResponse', identities: identities,
            error: err, bridgeVersion: BRIDGE_VERSION, reqTs: msg.ts, ts: Date.now() }));
        }
      })();
      return;
    }

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
      if (msg.playing && video.paused) video.play();
      else if (!msg.playing && !video.paused) video.pause();
      const drift = Math.abs(video.currentTime - msg.currentTime);
      if (drift > 1.5) video.currentTime = msg.currentTime;
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
      // QA Audit mode — read Apollo cache for base events + amendments up to current video time
      try {
        const endTs = video.currentTime * 1000; // ms
        const matchId = msg.matchId;
        const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract();
        if (!cache) {
          ws.send(JSON.stringify({ type: 'qaResultsResponse', error: 'Apollo cache not available', ts: Date.now() }));
          return;
        }

        const numMatchId = typeof matchId === 'string' ? parseInt(matchId) : matchId;
        const EXCLUDED = ['starting-xi', 'half-start', 'squad'];

        // Base events up to video time — deduplicated by key
        const seenBase = new Set();
        const baseEvents = Object.values(cache).filter(v => {
          if (v.__typename !== 'Event') return false;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return false;
          if (v.category !== 'base') return false;
          if (!v.payload || typeof v.payload.videoTimestamp !== 'number') return false;
          if (v.payload.videoTimestamp <= 0 || v.payload.videoTimestamp > endTs) return false;
          if (EXCLUDED.includes(v.payload.name)) return false;
          if (seenBase.has(v.key)) return false;
          seenBase.add(v.key);
          return true;
        }).map(v => ({
          id: v.id,
          key: v.key,
          name: v.payload.name,
          videoTimestamp: v.payload.videoTimestamp,
          teamId: v.payload.teamId,
          author: v.author,
          capturedTime: v.capturedTime,
        }));

        // Only amendments whose base event is within video time range
        const baseKeysInRange = new Set(baseEvents.map(e => e.key));
        const amendments = Object.values(cache).filter(v => {
          if (v.__typename !== 'Event') return false;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return false;
          if (v.category !== 'amendment') return false;
          if (!baseKeysInRange.has(v.key)) return false;
          return true;
        }).map(v => ({
          id: v.id,
          key: v.key,
          type: v.type,
          author: v.author,
          capturedTime: v.capturedTime,
          payload: v.payload,
          originalName: null, // will be resolved by MARK using baseEvents
        }));

        // Resolve original event name for each amendment
        const baseByKey = {};
        baseEvents.forEach(e => { baseByKey[e.key] = e; });
        amendments.forEach(a => {
          if (baseByKey[a.key]) a.originalName = baseByKey[a.key].name;
        });

        // Get collector + reviewer ids
        const collectorId = baseEvents.length > 0 ? baseEvents[0].author : null;
        const reviewerAmendments = amendments.filter(a => a.author !== collectorId);
        const reviewerId = reviewerAmendments.length > 0 ? reviewerAmendments[0].author : null;

        ws.send(JSON.stringify({
          type: 'qaResultsResponse',
          matchId: numMatchId,
          videoTime: video.currentTime,
          baseEvents,
          amendments,
          collectorId,
          reviewerId,
          identities: identitiesArray(),  // whatever's been harvested so far (passive tap / prior sweep)
          bridgeVersion: BRIDGE_VERSION,
          ts: Date.now(),
        }));

      } catch(e) {
        console.error('[MARK] getQAResults error:', e);
        ws.send(JSON.stringify({ type: 'qaResultsResponse', error: e.message, ts: Date.now() }));
      }
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

    // Connect WebSocket to localhost
    connectWs(video);

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
    const v = document.querySelector('video');
    if (v && v !== attachedVideo) attachVideo(v, auth.currentUser);
  }, 1000);

  // Auth state observer
  auth.onAuthStateChanged(u => {
    if (u) {
      console.log('[MARK] auth ready as', u.email);
      panel.style.display = 'none';
      const v = document.querySelector('video');
      if (v) attachVideo(v, u);
    } else {
      showLogin();
    }
  });
})();
`;

const MARKER = '<!-- MARK_BRIDGE_INJECTED v4 -->';

function readAsar(asarPath) {
  const bytes = fs.readFileSync(asarPath);
  const jsonLen = bytes.readUInt32LE(12);
  const jsonStr = bytes.slice(16, 16 + jsonLen).toString('utf8');
  const header = JSON.parse(jsonStr);
  const aligned = (jsonLen + 3) & ~3;
  const dataStart = 16 + aligned;
  const appHtml = header.files['app.html'];
  const offset = parseInt(appHtml.offset);
  const size = parseInt(appHtml.size);
  const html = bytes.slice(dataStart + offset, dataStart + offset + size).toString('utf8');
  return { html, header, bytes, dataStart, offset, size };
}

function writeAsar(asarPath, { html: newHtml, header, bytes, dataStart, offset, size }) {
  const newHtmlBytes = Buffer.from(newHtml, 'utf8');
  const sizeDelta = newHtmlBytes.length - size;
  header.files['app.html'].size = newHtmlBytes.length;

  function shiftOffsets(files, threshold, delta) {
    for (const key of Object.keys(files)) {
      const f = files[key];
      if (f.files) shiftOffsets(f.files, threshold, delta);
      if (f.offset !== undefined) {
        const off = parseInt(f.offset);
        if (off > threshold) f.offset = String(off + delta);
      }
    }
  }
  shiftOffsets(header.files, offset, sizeDelta);

  const newJsonStr = JSON.stringify(header);
  const newJsonBytes = Buffer.from(newJsonStr, 'utf8');
  const newJsonLen = newJsonBytes.length;
  const newAligned = (newJsonLen + 3) & ~3;

  const data = bytes.slice(dataStart);
  const newData = Buffer.concat([
    data.slice(0, offset),
    newHtmlBytes,
    data.slice(offset + size)
  ]);

  const out = Buffer.alloc(16 + newAligned + newData.length);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(8 + newAligned, 4);
  out.writeUInt32LE(4 + newAligned, 8);
  out.writeUInt32LE(newJsonLen, 12);
  newJsonBytes.copy(out, 16);
  out.fill(0, 16 + newJsonLen, 16 + newAligned);
  newData.copy(out, 16 + newAligned);

  fs.writeFileSync(asarPath, out);
}

// Read collection app asar
const asar = readAsar(collAsar);
console.log('Collection app asar read OK');
console.log('Current marker:', asar.html.includes('MARK_BRIDGE_INJECTED') ? asar.html.match(/MARK_BRIDGE_INJECTED [^-]*/)[0] : 'none');

if (asar.html.includes(MARKER)) {
  console.log('Already patched with v4 — nothing to do');
  process.exit(0);
}

// Strip any existing MARK bridge
let html = asar.html;
if (html.includes('<!-- MARK_BRIDGE_INJECTED')) {
  const start = html.indexOf('<!-- MARK_BRIDGE_INJECTED');
  const before = html.slice(0, start).trimEnd();
  html = before + '\n  </body>';
  console.log('Stripped old bridge');
}

// Inject new bridge
const injection = `    ${MARKER}\n    <script>\n${NEW_BRIDGE}\n    </script>\n  </body>`;
const newHtml = html.replace('</body>', injection);

if (newHtml === html) {
  console.log('ERROR: </body> not found');
  process.exit(1);
}

// Backup
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(collAsar, backupPath);
  console.log('Backup created:', backupPath);
}

writeAsar(collAsar, { ...asar, html: newHtml });
console.log('SUCCESS — collection app patched with bridge v6.0.1-ws');
console.log('Close and reopen collection app to apply');
