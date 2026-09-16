import { useState, useEffect } from 'react'

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    function onToast(e) {
      const { id, message, type, duration } = e.detail
      setToasts(prev => [...prev, { id, message, type }])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration || 8000)
    }
    window.addEventListener('mark:toast', onToast)
    return () => window.removeEventListener('mark:toast', onToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxWidth: 420, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} className="fade-in" style={{
          background: t.type === 'error' ? '#2a1010' : '#0f2a18',
          border: `1px solid ${t.type === 'error' ? '#FF453A' : '#30D158'}`,
          borderRadius: 12,
          padding: '14px 18px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
          pointerEvents: 'auto',
          backdropFilter: 'blur(12px)',
          minWidth: 260,
        }}>
          {t.type === 'error'
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF453A" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M20 6L9 17l-5-5"/></svg>
          }
          <div style={{ fontSize: 13, color: t.type === 'error' ? '#FF453A' : '#30D158', lineHeight: 1.4, wordBreak: 'break-all' }}>
            {t.message}
          </div>
        </div>
      ))}
    </div>
  )
}
