/**
 * SearchSelect.jsx: a single-select dropdown you can type into. The only kind of input on the Self-Review dashboard.
 * ============================================================================
 * Not free text: the box searches the list, and only an item from the list can be chosen. Click or press ↓ / Enter to open,
 * type to narrow, ↑ ↓ to move, Enter to choose, Esc to close without changing anything. An empty search shows "No results".
 *
 * options: [{ value, label }]   value: the selected option's value (strings or numbers)   onChange(value)
 * (MultiFilter.jsx is a checkbox multi-select with no search and belongs to Comparison; it is not reused here.)
 */
import { useState, useRef, useEffect, useMemo, useId } from 'react'

const S = {
  wrap:  { position:'relative', minWidth:150 },
  label: { display:'block', fontSize:11, color:'var(--t-3)', marginBottom:3 },
  input: { width:'100%', boxSizing:'border-box', background:'var(--bg-3)', color:'var(--t-1)', border:'1px solid var(--b-2)',
           borderRadius:8, padding:'7px 28px 7px 10px', font:'inherit', fontSize:13, cursor:'pointer', outline:'none' },
  caret: { position:'absolute', right:10, bottom:9, color:'var(--t-3)', pointerEvents:'none', fontSize:11 },
  list:  { position:'absolute', zIndex:30, left:0, right:0, top:'100%', margin:'3px 0 0', padding:4, listStyle:'none', maxHeight:220,
           overflowY:'auto', background:'var(--bg-3)', border:'1px solid var(--b-2)', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,.45)' },
  item:  { padding:'6px 8px', borderRadius:6, cursor:'pointer', fontSize:13, color:'var(--t-1)' },
}

export default function SearchSelect({ label, options, value, onChange, disabled = false, width, testId }) {
  const uid = useId()
  const listId = `${uid}-list`
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const current = options.find(o => o.value === value)
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? options.filter(o => String(o.label).toLowerCase().includes(needle)) : options
  }, [options, q])

  // keep the highlighted option visible when arrowing through a long list
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector('[data-hl="1"]')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' })
  }, [hl, open, shown])

  function openList() {
    if (disabled) return
    setQ(''); setHl(Math.max(0, options.findIndex(o => o.value === value))); setOpen(true)
  }
  function close() { setOpen(false); setQ('') }
  function pick(i) {
    const o = shown[i]
    if (!o) return
    close()
    if (o.value !== value) onChange && onChange(o.value)
  }
  function onKeyDown(e) {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl(h => Math.min(h + 1, Math.max(0, shown.length - 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hl) }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'Tab') close()
  }

  return (
    <div style={{ ...S.wrap, ...(width ? { minWidth: width } : null) }} data-testid={testId}>
      {label && <label style={S.label} htmlFor={`${uid}-in`}>{label}</label>}
      <input
        id={`${uid}-in`} ref={inputRef} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && shown[hl] ? `${uid}-o${hl}` : undefined} aria-disabled={disabled || undefined}
        style={{ ...S.input, ...(disabled ? { opacity:.55, cursor:'not-allowed' } : null) }}
        disabled={disabled} readOnly={!open} autoComplete="off" spellCheck={false}
        value={open ? q : (current ? current.label : '')}
        onClick={() => (open ? null : openList())}
        onChange={e => { setQ(e.target.value); setHl(0) }}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
      <span style={S.caret} aria-hidden="true">▾</span>
      {open && (
        <ul id={listId} ref={listRef} role="listbox" style={S.list}
            onMouseDown={e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); pick(Number(li.dataset.i)) } }}>
          {shown.length === 0
            ? <li role="option" aria-disabled="true" aria-selected="false" style={{ ...S.item, color:'var(--t-3)', cursor:'default' }}>No results</li>
            : shown.map((o, i) => (
              <li key={String(o.value)} id={`${uid}-o${i}`} role="option" data-i={i} data-hl={i === hl ? '1' : '0'}
                  aria-selected={o.value === value}
                  onMouseEnter={() => setHl(i)}
                  style={{ ...S.item, background: i === hl ? 'var(--p2)' : 'transparent', color: i === hl ? '#fff' : 'var(--t-1)' }}>
                {o.label}
              </li>))}
        </ul>
      )}
    </div>
  )
}
