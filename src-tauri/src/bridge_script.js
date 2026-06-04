(async function(){
  if(window.__MARK_BRIDGE__){console.log('[MARK] bridge already running');return;}
  window.__MARK_BRIDGE__=true;
  console.log('[MARK] bridge starting, session=__SESSION_ID__');
  const sid='__SESSION_ID__';
  const video=document.querySelector('video');
  if(!video){console.error('[MARK] No video found');alert('[MARK] No video element found on this page.');return;}
  const load=src=>new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=fail;document.head.appendChild(s);});
  const CDN='https://www.gstatic.com/firebasejs/10.12.2';
  try{
    await load(CDN+'/firebase-app-compat.js');
    await load(CDN+'/firebase-auth-compat.js');
    await load(CDN+'/firebase-firestore-compat.js');
  }catch(e){alert('[MARK] Could not load Firebase (no internet?): '+e);return;}
  if(!firebase.apps.length)firebase.initializeApp({apiKey:'AIzaSyB-HWh2kJgoPDwzYhZWgW6pi8uZK8u9K7U',authDomain:'hudl-training-ops.firebaseapp.com',projectId:'hudl-training-ops',storageBucket:'hudl-training-ops.appspot.com'});
  const auth=firebase.auth(),db=firebase.firestore();
  const panel=document.createElement('div');panel.id='__mark_panel__';
  Object.assign(panel.style,{position:'fixed',top:'12px',right:'12px',zIndex:'2147483647',background:'#111827',color:'#f9fafb',borderRadius:'12px',padding:'16px',fontFamily:'Inter,system-ui,sans-serif',fontSize:'12px',boxShadow:'0 8px 32px rgba(0,0,0,.6)',width:'224px',border:'1px solid #374151',lineHeight:'1.5'});
  document.body.appendChild(panel);
  const $=id=>panel.querySelector('#'+id);
  function showLogin(err){
    panel.innerHTML='<b style="font-size:13px">MARK Bridge</b>'+(err?'<p style="color:#f87171;margin:6px 0 0;font-size:11px">'+err+'</p>':'')+'<p style="color:#9ca3af;margin:8px 0 4px;font-size:11px">Sign in with your FIELD account</p><input id="mb_e" type="email" placeholder="Email" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font-size:12px;margin-bottom:6px"><input id="mb_p" type="password" placeholder="Password" style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font-size:12px;margin-bottom:10px"><button id="mb_btn" style="width:100%;padding:8px;border:none;border-radius:8px;background:#e8500a;color:#fff;font-weight:700;cursor:pointer;font-size:12px">Sign In</button>';
    const go=()=>auth.signInWithEmailAndPassword($('mb_e').value.trim(),$('mb_p').value).catch(e=>showLogin(e.message));
    $('mb_btn').onclick=go;
    $('mb_p').onkeydown=e=>{if(e.key==='Enter')go();};
  }
  let unsub=null;
  function connect(user){
    if(unsub)unsub();
    let last=Date.now();
    unsub=db.collection('mark_sessions').doc(sid).onSnapshot(snap=>{
      if(!snap.exists)return;
      const c=snap.data().navCommand;
      if(!c||c.ts<=last)return;
      last=c.ts;
      const step=c.shift?0.04:0.4;
      if(c.action==='forward')video.currentTime=Math.max(0,video.currentTime+step);
      else if(c.action==='backward')video.currentTime=Math.max(0,video.currentTime-step);
      else if(c.action==='playpause')video.paused?video.play():video.pause();
    },e=>console.error('[MARK] snapshot error',e));
    panel.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:13px">MARK Bridge</b><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block" title="Synced"></span></div><div style="color:#9ca3af;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:10px">'+user.email+'</div><div style="color:#6b7280;font-size:10px;font-weight:600;letter-spacing:.5px;margin-bottom:2px">VIDEO TIME</div><div id="mb_t" style="font-size:24px;font-weight:800;color:#e8500a;font-variant-numeric:tabular-nums;letter-spacing:1px">-:--</div>';
    video.addEventListener('timeupdate',()=>{const el=$('mb_t');if(!el)return;const t=video.currentTime,m=Math.floor(t/60),s=Math.floor(t%60);el.textContent=m+':'+(s<10?'0':'')+s;});
    console.log('[MARK] connected & listening as',user.email);
  }
  auth.onAuthStateChanged(u=>{if(u)connect(u);else showLogin();});
})();
