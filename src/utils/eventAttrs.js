/**
 * eventAttrs.js — the attribute text the Comparison Event Detail table shows, rebuilt for the read-only My halves
 * view.
 *
 * compareEngine.js builds `model_attrs` / `collector_attrs` in memory with a private attrSummary() and never stores
 * them (comparison_detail has no such columns). The values themselves ARE stored, one column per group on every
 * field_events row, so the text can be rebuilt exactly. This is a copy of that function, so the engine is not edited;
 * eventAttrs.test.mjs runs the engine's own source against this one on the same inputs to prove they agree.
 */
export function attrSummary(ev) {
  if (!ev) return { short: '', full: '' }
  const shorts = [], fulls = []
  Object.keys(ev).filter(k => k.startsWith('attr_')).forEach(k => {
    const raw = String(ev[k] ?? '').trim()
    if (!raw) return
    const group = k.replace(/^attr_/, '')
    const vals = raw.split('|').map(x => x.trim()).filter(Boolean)
    shorts.push(vals.map(v => v.includes('_') ? v.slice(v.indexOf('_') + 1) : v).join('+'))
    fulls.push(group + '=' + vals.join('+'))
  })
  return { short: shorts.join(', '), full: fulls.join('  ·  ') }
}
