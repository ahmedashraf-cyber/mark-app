/**
 * sheetsFetch.js: how a Google Sheets failure is described. Shared by the Self-Review save path and the dashboard loader, so the
 * same failure reads the same everywhere.
 * ============================================================================
 * A reply that is not JSON (an HTML error page, an empty body) used to surface as a bare JSON parse error with no status, no
 * spreadsheet and no tab. Now every failure names WHAT was being done, to WHICH tab of WHICH spreadsheet, and what Google answered:
 * the HTTP status and Google's own message or, for a non-JSON reply, the first words of it.
 */
export const shortId = id => (id ? `${id.slice(0, 6)}…${id.slice(-4)}` : '(unknown id)')

/** 'the "Collector Self Review" tab of spreadsheet 1l3tYw…oTec' from a Sheets API URL. */
export function describeTarget(url) {
  const id = (/\/spreadsheets\/([^/:?]+)/.exec(url) || [])[1]
  let tab = ''
  const m = /\/values\/([^?]+)/.exec(url)
  if (m) { try { tab = decodeURIComponent(m[1]).replace(/:append$/, '').split('!')[0].replace(/^'(.*)'$/, '$1') } catch { /* keep blank */ } }
  return `${tab ? `the "${tab}" tab of ` : ''}spreadsheet ${shortId(id)}`
}
export const verbFor = (method, url) => (method === 'GET' ? 'reading' : /:append/.test(url) ? 'appending to' : 'writing to')

/** The first 120 readable characters of a reply: tags, scripts and extra spaces removed. */
export function snippet(raw) {
  const t = String(raw || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

/** { data, raw }: data is undefined when the reply is empty or not JSON. Never throws. Works with a real Response or a json()-only fake. */
export async function readReply(res) {
  let raw = ''
  try {
    if (typeof res.text === 'function') raw = await res.text()
    else if (typeof res.json === 'function') return { data: await res.json(), raw: '' }
  } catch { return { data: undefined, raw: '' } }
  if (!raw) return { data: undefined, raw: '' }
  try { return { data: JSON.parse(raw), raw } } catch { return { data: undefined, raw } }
}

/** The message for a reply that failed (not ok) or that was not JSON. */
export function failureMessage(res, method, url, data, raw) {
  const what = `${verbFor(method, url)} ${describeTarget(url)}`
  const status = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`
  if (!res.ok) return `Google Sheets answered ${status} while ${what}: ${data?.error?.message || snippet(raw) || '(empty reply)'}`
  return `Google Sheets answered ${status} while ${what}, but the reply was not JSON: ${snippet(raw) || '(empty reply)'}`
}
