/**
 * MultiFilter.jsx — a multi-select dropdown with checkboxes
 * ============================================================================
 * A native <select multiple> cannot show checkboxes, cannot carry a select-all
 * row, and on Windows requires ctrl-click to add rather than replace — which is
 * exactly the behaviour being replaced here. So this is a custom popover.
 *
 * Selection is held by the caller as an array. An EMPTY array means "all",
 * not "none": that way the filter starts inert and a cleared filter stops
 * filtering rather than hiding every row.
 */
import { useState, useRef, useEffect } from 'react'

export default function MultiFilter({
  label,            // shown when nothing is selected, e.g. "All events"
  options,          // [string] or [{ value, label }]
  selected,         // [string]
  onChange,         // (nextArray) => void
  labelFor,         // optional (value) => display string
  width = 168,
  title,
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on an outside click. mousedown rather than click so the popover is
  // gone before any underlying control reacts, and the selection is never
  // touched — closing is not clearing.
  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const norm = options.map(o => typeof o === 'string' ? { value: o, label: o } : o)
  const show = v => labelFor ? labelFor(v) : (norm.find(o => o.value === v)?.label ?? v)
  const allSelected = selected.length > 0 && selected.length === norm.length

  const toggle = value => {
    onChange(selected.includes(value)
      ? selected.filter(v => v !== value)
      : [...selected, value])
  }

  // Summary: names while they fit, a count once they do not.
  const summary = (() => {
    if (!selected.length) return label
    const joined = selected.map(show).join(', ')
    return joined.length <= 22 ? joined : `${selected.length} selected`
  })()

  return (
    <div ref={wrapRef} style={{ position:'relative', width }} title={title}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          width:'100%', textAlign:'left', display:'flex', alignItems:'center', gap:6,
          background:'var(--bg-3)', border:`1px solid ${selected.length ? 'var(--p2)' : 'var(--b-1)'}`,
          borderRadius:6, padding:'5px 8px', fontSize:10, cursor:'pointer',
          color: selected.length ? 'var(--t-1)' : 'var(--t-3)',
        }}>
        <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis',
          whiteSpace:'nowrap' }}>{summary}</span>
        {selected.length > 0 && (
          <span style={{ fontSize:8, fontWeight:800, color:'var(--p2)',
            background:'rgba(232,89,12,0.16)', borderRadius:3, padding:'1px 4px' }}>
            {selected.length}
          </span>
        )}
        <span style={{ fontSize:8, color:'var(--t-3)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:60,
          minWidth:'100%', maxWidth:260, maxHeight:280, overflowY:'auto',
          background:'var(--bg-2)', border:'1px solid var(--b-1)', borderRadius:7,
          boxShadow:'0 8px 26px rgba(0,0,0,0.55)', padding:4,
        }}>
          <div
            onClick={() => onChange(allSelected ? [] : norm.map(o => o.value))}
            style={{ padding:'6px 8px', fontSize:10, fontWeight:700, cursor:'pointer',
              color:'var(--p2)', borderBottom:'1px solid var(--b-1)', marginBottom:2 }}>
            {allSelected ? 'Clear all' : 'Select all'}
            <span style={{ color:'var(--t-3)', fontWeight:400 }}>
              {'  '}({norm.length})
            </span>
          </div>

          {norm.map(o => {
            const on = selected.includes(o.value)
            return (
              <div key={o.value} onClick={() => toggle(o.value)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 8px',
                  borderRadius:5, cursor:'pointer',
                  background: on ? 'rgba(232,89,12,0.10)' : 'transparent' }}>
                <span style={{ width:13, height:13, borderRadius:3, flexShrink:0,
                  border:`1.5px solid ${on ? 'var(--p2)' : 'var(--b-2)'}`,
                  background: on ? 'var(--p2)' : 'transparent',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:9, fontWeight:900, color:'#000', lineHeight:1 }}>
                  {on ? '✓' : ''}
                </span>
                <span style={{ fontSize:10, color: on ? 'var(--t-1)' : 'var(--t-2)',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {o.label}
                </span>
              </div>
            )
          })}

          {!norm.length && (
            <div style={{ padding:'8px', fontSize:10, color:'var(--t-3)' }}>
              Nothing to filter by.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
