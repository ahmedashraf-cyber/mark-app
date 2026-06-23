(async function(){
  const BRIDGE_VERSION = '7.5.0';
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

  function handleSyncMessage(msg, _capturedVideo) {
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

        // Main collector = author of the most base events
        const baseAuthorCounts = {};
        allBase.forEach(v => { baseAuthorCounts[v.author] = (baseAuthorCounts[v.author] || 0) + 1; });
        const topBase = Object.entries(baseAuthorCounts).sort((a,b) => b[1]-a[1])[0]?.[0];
        collectorIdNum = topBase != null ? parseInt(topBase) : null;

        // Per-author change tally (Rule 2/3): amendments authored in this half.
        // A reviewer must have made at least one change — Rule 3: a Viewed-Event
        // author with zero edits/adds is a playthrough, NOT a reviewer.
        const changeCounts = {};
        Object.values(cache).forEach(v => {
          if (!v || v.__typename !== 'Event') return;
          if (v.matchId !== numMatchId && v.matchId !== String(numMatchId)) return;
          if (partId && v.partId !== partId) return;
          if (v.category === 'amendment') changeCounts[v.author] = (changeCounts[v.author] || 0) + 1;
        });
        // base events authored by a non-collector = added (missed) events, also count as a change
        const hasChange = a => (changeCounts[a] || 0) > 0 || (baseAuthorCounts[a] || 0) > 0;

        try {
          const telemetryAll = Object.values(cache).filter(v =>
            v.__typename === 'Event' && v.category === 'telemetry' &&
            (v.matchId === numMatchId || v.matchId === String(numMatchId)) &&
            v.type === 'event-activation' && (!partId || v.partId === partId)
          );

          // Rule 1 (Viewed Event) + Rule 3 (must have made >=1 edit/add), excluding
          // the main collector. Drops playthrough viewers who opened events but
          // changed nothing.
          reviewerIds = [...new Set(telemetryAll.map(t => t.author))]
            .filter(a => a !== collectorIdNum && hasChange(a));
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
        // Fallback (no telemetry at all): most frequent non-collector editor.
        if (reviewerIds.length === 0) {
          const reviewerCounts = {};
          amendments.forEach(a => { if (a.author !== collectorIdNum) reviewerCounts[a.author] = (reviewerCounts[a.author]||0)+1; });
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
          universeBase:     allBase.length,
          reviewed:         baseEvents.length,
          telemetry:        telSorted.map(t => ({ author: t.author, views: t.views, firstTs: (t.firstTs === Infinity ? 0 : t.firstTs) })),
          amendmentAuthors: Object.entries(amendAuthorCounts).map(([author,count]) => ({ author: parseInt(author), count })),
          baseAuthors:      Object.entries(baseAuthorCounts).map(([author,count]) => ({ author: parseInt(author), count })),
        };

        ws.send(JSON.stringify({
          type: 'qaResultsResponse',
          matchId: numMatchId,
          bridgeVersion: BRIDGE_VERSION,
          videoTime: video.currentTime,
          baseEvents,
          amendments,
          collectorId,
          reviewerId,
          reviewerIds,
          diagnostics,
          usedTelemetry,
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
