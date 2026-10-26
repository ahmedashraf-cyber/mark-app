/**
 * services/google — the ONE place the UI talks to Google Sheets / Drive.
 * ============================================================================
 * Why this exists (docs/audit/03-architecture-review.md, A1/A3): before this module, 20 call sites
 * fetched the service-account token themselves, the Sheets host was spelled out in 17 files and the
 * `Authorization: Bearer …` header was assembled by hand ~48 times. Nothing could change how
 * credentials reach Google without touching all of them.
 *
 * What it is NOT: a redesign. Every function here does exactly what the code it replaced did, so
 * moving a call site onto it must not change a single request (URL, method, headers, body). A test
 * pins that (src/services/google/index.test.js) and an ESLint rule keeps new code from going around
 * it (see eslint.config.mjs).
 *
 * The seam: `getServiceToken()` decides WHERE a credential comes from and `googleFetch()` decides HOW
 * a request is sent. Replacing either is a change to this file, not to 19 others.
 */
import { invoke } from '@tauri-apps/api/core'

/** Google Sheets API v4 — spreadsheets collection. */
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
/** Google Drive API v3 — files collection. */
export const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
/** OpenID user-info (the signed-in reviewer's e-mail). */
export const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo'

/**
 * Access token for the mark-reporter service account, minted by the Rust side
 * (`get_google_access_token_cmd`). Not cached here: callers fetch one per operation, as before.
 * `inv` exists so tests (and callers that were handed their own `invoke`) can supply it.
 * @param {(cmd: string) => Promise<any>} [inv]
 * @returns {Promise<string>}
 */
export function getServiceToken(inv = invoke) {
  return inv('get_google_access_token_cmd')
}

/**
 * `fetch` with a bearer token. Exactly equivalent to
 *   fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...headers } })
 * which is what the replaced call sites wrote out by hand.
 *
 * @param {string} url
 * @param {RequestInit & { token: string, headers?: Record<string, string> }} init
 * @returns {Promise<Response>}
 */
export function googleFetch(url, { token, headers, ...init } = /** @type {any} */ ({})) {
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...headers } })
}
