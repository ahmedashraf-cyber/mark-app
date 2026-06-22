// half.js — single source of truth for half identifiers and their display names.
// Internal ids ('1H','2H','ET1','ET2') are used for locks, sessions, partId mapping
// and clip filenames. The labels below are what the user sees on every MARK page.

export const HALVES = [
  { id: '1H',  label: '1st Half' },
  { id: '2H',  label: '2nd Half' },
  { id: 'ET1', label: 'ET 1' },
  { id: 'ET2', label: 'ET 2' },
]

// Map a stored half id to its display name. Falls back to the raw value so
// nothing ever renders blank if an unknown id slips through.
export function formatHalf(id) {
  const found = HALVES.find(h => h.id === id)
  return found ? found.label : (id || '')
}
