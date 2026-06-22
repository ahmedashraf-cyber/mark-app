import { useState, useEffect } from 'react'
import { db } from '../firebase/config'
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'
import { formatHalf } from '../utils/half.js'

function fmtVideo(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function fmtElapsed(startedAt) {
  if (!startedAt?.toDate) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - startedAt.toDate().getTime()) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function ObserverPage({ session, onBack }) {
  const [tags, setTags] = useState([])
  const [liveSession, setLiveSession] = useState(session)
  const [, setTick] = useState(0)

  useEffect(() => {
    const q = query(collection(db, 'mark_error_tags'), where('sessionId', '==', session.sessionId))
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      list.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0))
      setTags(list)
    })
  }, [session.sessionId])

  useEffect(() => {
    return onSnapshot(doc(db, 'mark_sessions', session.sessionId), snap => {
      if (snap.exists()) setLiveSession({ id: snap.id, ...snap.data() })
    })
  }, [session.sessionId])

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const isAudit = session.mode === 'audit' || session.type === 'audit'
  const isLive = liveSession.status === 'in_progress'
  const reviewerName = session.reviewerName || session.reviewerEmail?.split('@')[0] || 'Unknown'
  const elapsedStr = fmtElapsed(liveSession.startedAt)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ flexShrink: 0, height: 52, background: 'var(--bg-2)', borderBottom: '1px solid var(--b-1)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12 }}>
        <button className="btn-ghost" style={{ padding: '5px 12px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }} onClick={onBack}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          Back
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--b-2)' }} />

        {isLive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.28)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF3B30', boxShadow: '0 0 8px rgba(255,59,48,0.9)' }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#FF3B30', letterSpacing: 1 }}>LIVE</span>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 13, color: 'var(--t-1)' }}>{session.matchName}</span>
          <span style={{ fontSize: 11, color: 'var(--t-3)', marginLeft: 8 }}>{formatHalf(session.half)}</span>
        </div>

        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 700,
          background: isAudit ? 'rgba(10,132,255,0.12)' : 'rgba(232,89,12,0.12)',
          color: isAudit ? '#0A84FF' : 'var(--p2)',
          border: `1px solid ${isAudit ? 'rgba(10,132,255,0.2)' : 'rgba(232,89,12,0.2)'}`,
        }}>{isAudit ? 'AUDIT' : 'SCOUT'}</span>

        <span style={{ fontSize: 11, color: 'var(--t-3)' }}>{reviewerName}</span>

        <div style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.2)' }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#FFD700', letterSpacing: 1 }}>👑 OBSERVER</span>
        </div>
      </header>

      {/* Stats strip */}
      <div style={{ flexShrink: 0, padding: '10px 20px', borderBottom: '1px solid var(--b-1)', background: 'var(--bg-2)', display: 'flex', gap: 10 }}>
        {[
          { label: 'ERRORS TAGGED', value: tags.length, color: '#FF453A' },
          { label: 'ELAPSED', value: elapsedStr, color: 'var(--t-2)' },
          { label: 'STATUS', value: isLive ? 'In Progress' : 'Completed', color: isLive ? '#30D158' : 'var(--t-3)' },
          ...(liveSession.qualityScore != null ? [{ label: 'QUALITY', value: `${liveSession.qualityScore}%`, color: liveSession.qualityScore >= 80 ? '#30D158' : liveSession.qualityScore >= 60 ? '#FFD60A' : '#FF453A' }] : []),
        ].map(stat => (
          <div key={stat.label} style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--b-1)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--t-3)', letterSpacing: 1.5 }}>{stat.label}</span>
            <span style={{ fontSize: 16, fontWeight: 900, fontFamily: 'Inter', color: stat.color }}>{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Live tag feed */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {tags.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--t-3)" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
            </svg>
            <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
              {isLive ? 'Waiting for first error tag…' : 'No errors were tagged in this session'}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tags.map((tag, i) => {
              const tagTime = tag.createdAt?.toDate?.()?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) || ''
              return (
                <div key={tag.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: i === 0 && isLive ? 'rgba(255,69,58,0.06)' : 'var(--bg-2)',
                  border: `1px solid ${i === 0 && isLive ? 'rgba(255,69,58,0.22)' : 'var(--b-1)'}`,
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(255,69,58,0.1)', border: '1.5px solid rgba(255,69,58,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, fontSize: 11, color: '#FF453A' }}>{fmtVideo(tag.videoTimeSec || 0)}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t-1)', marginBottom: 3 }}>
                      {tag.triggeredEventLabel || tag.triggeredKey || 'Error'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, fontSize: 10 }}>
                      {tag.team && (
                        <span style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--b-1)', color: 'var(--t-3)' }}>{tag.team}</span>
                      )}
                      {(tag.extras || []).map(e => (
                        <span key={e} style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(232,89,12,0.08)', border: '1px solid rgba(232,89,12,0.2)', color: 'var(--p2)' }}>{e}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {tagTime && <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--t-3)' }}>{tagTime}</span>}
                    {i === 0 && isLive && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF3B30', boxShadow: '0 0 6px rgba(255,59,48,0.8)' }} />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
