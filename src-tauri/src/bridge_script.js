(async function(){
  if(window.__MARK_BRIDGE__){console.log('[MARK] bridge already running');return;}
  window.__MARK_BRIDGE__=true;
  console.log('[MARK] bridge starting');

  // ── Optional auto-auth tokens (substituted by MARK at inject time) ────────
  // When the bridge is embedded via asar patch, these stay as literal "__..."
  // strings. The script detects this and shows the manual sign-in panel only
  // for the first sign-in on this PC — Firebase persists the auth after that.
  const __MARK_FB_API_KEY__ = 'AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U';
  const __MARK_ID_TOKEN__ = '__ID_TOKEN__';
  const __MARK_REFRESH_TOKEN__ = '__REFRESH_TOKEN__';
  const __MARK_UID__ = '__USER_UID__';
  const __MARK_EMAIL__ = '__USER_EMAIL__';

  // Pre-seed Firebase persistence BEFORE the SDK loads. When firebase.auth()
  // initializes below, it reads localStorage, finds this user, refreshes the
  // ID token automatically via the refresh token, and fires onAuthStateChanged
  // with a valid user. No panel ever shown when this path works.
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

  // Wait for document body
  if (!document.body) {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
  }

  // Load Firebase SDKs from CDN
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
      const cache = window.apollo && window.apollo.client && window.apollo.client.cache.extract();
      if (!cache) return -1;
      const numMatchId = typeof matchId === 'string' ? parseInt(matchId) : matchId;
      return Object.values(cache).filter(v =>
        v.__typename === 'Event' &&
        (v.matchId === numMatchId || v.matchId === String(numMatchId)) &&
        v.payload &&
        typeof v.payload.videoTimestamp === 'number' &&
        v.payload.videoTimestamp > 0 &&
        v.payload.videoTimestamp <= endTs &&
        !EXCLUDED_TYPES.includes(v.payload.name)
      ).length;
    } catch(e) {
      console.error('[MARK] countEventsInRange error:', e);
      return -1;
    }
  }

  // ── Session listener ──────────────────────────────────────────────────────
  let attachedVideo = null;
  let unsubActiveQuery = null;
  let unsubSessionDoc = null;
  let currentSid = null;

  function listenToSession(sid, video) {
    let lastNav = 0, lastPos = 0, lastSeek = 0, lastCount = 0;
    let lastTimeWrite = 0, lastTimeReq = 0;

    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastTimeWrite < 1000) return;
      lastTimeWrite = now;
      db.collection('mark_sessions').doc(sid).set({
        collectionAppTime: { currentTime: video.currentTime * 1000, ts: now }
      }, { merge: true }).catch(e => console.error('[MARK] collectionAppTime write failed:', e));
    };
    video.addEventListener('timeupdate', onTimeUpdate);

    const unsub = db.collection('mark_sessions').doc(sid).onSnapshot(snap => {
      if (!snap.exists) return;
      const data = snap.data();

      const c = data.navCommand;
      if (c && c.ts > lastNav) {
        lastNav = c.ts;
        const step = c.shift ? 0.04 : 0.4;
        if (c.action === 'forward')       video.currentTime = Math.max(0, video.currentTime + step);
        else if (c.action === 'backward') video.currentTime = Math.max(0, video.currentTime - step);
      }

      const sk = data.seekCommand;
      if (sk && sk.ts > lastSeek) { lastSeek = sk.ts; video.currentTime = sk.currentTime; }

      const p = data.posSync;
      if (p && p.ts > lastPos) {
        lastPos = p.ts;
        if (p.playing && video.paused) video.play();
        else if (!p.playing && !video.paused) video.pause();
        const drift = Math.abs(video.currentTime - p.currentTime);
        if (drift > 1.5) video.currentTime = p.currentTime;
      }

      const tvReq = data.getVideoTimeRequest;
      if (tvReq && tvReq.ts > lastTimeReq) {
        lastTimeReq = tvReq.ts;
        db.collection('mark_sessions').doc(sid).update({
          getVideoTimeResponse: { time: video.currentTime, ts: Date.now() }
        });
      }

      const req = data.eventCountRequest;
      if (req && req.ts > lastCount) {
        lastCount = req.ts;
        const count = countEventsInRange(req.matchId, req.startTs, req.endTs);
        db.collection('mark_sessions').doc(sid).update({
          eventCountResponse: { count, ts: Date.now() }
        });
      }
    }, e => console.error('[MARK] snapshot error:', e));

    return () => { video.removeEventListener('timeupdate', onTimeUpdate); unsub(); };
  }

  function attachVideo(video, user) {
    if (attachedVideo === video) return;
    attachedVideo = video;
    video.muted = true;
    video.addEventListener('volumechange', () => { if (!video.muted) video.muted = true; });
    console.log('[MARK] video attached');

    if (unsubActiveQuery) unsubActiveQuery();

    // Find the user's most recent active session
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
          if (unsubSessionDoc) { unsubSessionDoc(); unsubSessionDoc = null; }
          currentSid = null;
          return;
        }
        if (best.id === currentSid && unsubSessionDoc) return;

        if (unsubSessionDoc) unsubSessionDoc();
        currentSid = best.id;
        console.log('[MARK] connected to session', currentSid);
        unsubSessionDoc = listenToSession(currentSid, video);
      }, e => console.error('[MARK] active session query error:', e));
  }

  // Poll for the video element (handles late-arriving DOM + navigation between matches)
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
