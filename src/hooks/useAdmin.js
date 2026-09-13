// Internal domains — extend this array to allow additional domains without a code change.
// The check is: email.toLowerCase().endsWith('@' + domain)
export const INTERNAL_DOMAINS = ['hudl.com']

// Returns true if the user's email belongs to an internal domain.
// External users (any other domain) get Field-only access.
export function useInternalUser(profile) {
  if (!profile?.email) return false
  const email = profile.email.toLowerCase()
  return INTERNAL_DOMAINS.some(d => email.endsWith('@' + d))
}

// Super admin access — hardcoded to ahmed.ashraf@hudl.com only
export function useAdmin(profile) {
  return profile?.email === 'ahmed.ashraf@hudl.com'
}

// ── DRILL roles ──────────────────────────────────────────────────────────────
// Resolved from the Supervisors tab (column C) of the same sheet HR-code login
// reads. Role authorises; login only identifies.
//
//   creator : role is Batch Supervisor or Batch Coordinator AND email @hudl.com
//   trainee : role CONTAINS 'Collector', any email domain
//   other   : no DRILL access at all
//
// The domain check applies to creators ONLY. Trainees are Gmail accounts, so
// requiring @hudl.com of them would lock every trainee out.
//
// `role` is supplied by the caller (drillPeople.js reads it from the sheet) so
// this stays a pure function and needs no network access.
export function resolveDrillRole(profile, role) {
  const email = (profile?.email || '').toLowerCase()
  const r     = (role || '').trim()
  if (!email || !r) return 'none'

  const isInternal = INTERNAL_DOMAINS.some(d => email.endsWith('@' + d))

  // exact match for creator roles
  if (['Batch Supervisor', 'Batch Coordinator'].includes(r)) {
    return isInternal ? 'creator' : 'none'
  }
  // substring for trainees — covers 'Offline Data Collector (Part)'
  if (r.toLowerCase().includes('collector')) return 'trainee'

  return 'none'
}

export function canCreateDrill(profile, role) {
  return resolveDrillRole(profile, role) === 'creator'
}
export function canTakeDrill(profile, role) {
  const r = resolveDrillRole(profile, role)
  return r === 'trainee' || r === 'creator'   // creators may test their own quizzes
}
