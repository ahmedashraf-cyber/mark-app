export default function UpdateBanner({ update, onDismiss }) {
  if (!update) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 9999,
      width: 320,
      background: 'var(--bg-2)',
      border: '1px solid rgba(48,209,88,0.4)',
      borderRadius: 14,
      padding: '14px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      animation: 'slideUp 0.3s ease both',
    }}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:'#30D158',display:'inline-block',boxShadow:'0 0 8px rgba(48,209,88,0.6)'}}/>
            <span style={{fontFamily:'Inter',fontWeight:700,fontSize:13,color:'var(--t-1)'}}>Update Available</span>
            <span style={{fontSize:11,color:'#30D158',fontWeight:700}}>v{update.version}</span>
          </div>
          <div style={{fontSize:12,color:'var(--t-3)',marginBottom:12}}>
            A new version of MARK is ready to install.
          </div>
          <div style={{display:'flex',gap:8}}>
            <a
              href={update.downloadUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                flex:2,
                background:'#30D158',
                color:'#000',
                border:'none',
                borderRadius:8,
                padding:'8px 0',
                fontSize:12,
                fontWeight:700,
                cursor:'pointer',
                textDecoration:'none',
                textAlign:'center',
                display:'block',
              }}
            >
              Download Update
            </a>
            <button
              onClick={onDismiss}
              className="btn-ghost"
              style={{flex:1,padding:'8px 0',fontSize:12}}
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
