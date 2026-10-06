/**
 * useAdmin.js — role-based access control
 * ============================================================================
 * Access is decided by the Role column (C) of the Supervisor tab, not by email
 * domain. The domain check that used to gate everything is gone: it let any
 * @hudl.com address into every mode regardless of job, while the collectors —
 * who are on Gmail — were excluded by it.
 *
 * Verified against the live sheet: 541 users, all seven roles spelled exactly
 * as below, nobody carrying an unrecognised role. Counts when written:
 * collectors 455, full-ops 84, managers 2.
 *
 * These are PURE functions. The role string is supplied by the caller
 * (drillPeople.js reads it from the sheet), so nothing here touches the network
 * and nothing here can fail when offline.
 *
 * SECURITY NOTE, recorded deliberately: column E of that sheet holds plaintext
 * passwords, and the sheet is readable by an API key shipped inside the app, so
 * it is effectively public. A leaked row therefore grants whatever role the row
 * names, including Batch Manager. This was raised; the decision was to keep
 * sheet passwords for now. Moving the 86 email users to Firebase Auth would
 * close it without touching any of the role logic below.
 */

/**
 * Kept for the transitional fallback below, and so existing imports resolve.
 * It is NOT the access authority any more — the role is.
 */
export const INTERNAL_DOMAINS = ['hudl.com']

// ── The seven roles, spelled exactly as stored in column C ──────────────────
export const ROLE = {
  MANAGER:          'Batch Manager',
  SUPERVISOR:       'Batch Supervisor',
  COORDINATOR:      'Batch Coordinator',
  QUALITY_REVIEWER: 'Offline Quality Reviewer',
  QUALITY_TL:       'Offline Quality Team Leader',
  COLLECTOR:        'Offline Data Collector',
  COLLECTOR_PART:   'Offline Data Collector (Part)',
  // Same access as Offline Quality Reviewer: every mode, no admin page.
  TRAINING_SUPPORTER: 'Training Supporter',
}

export const ALL_ROLES = Object.values(ROLE)

/** Full operational access, but no admin page. */
const FULL_OPS = [
  ROLE.SUPERVISOR, ROLE.COORDINATOR, ROLE.QUALITY_REVIEWER, ROLE.QUALITY_TL,
  ROLE.TRAINING_SUPPORTER,
]

/** The only two roles permitted to sign in with an HR-code. */
export const COLLECTOR_ROLES = [ROLE.COLLECTOR, ROLE.COLLECTOR_PART]

/**
 * Normalise before comparing. Sheet cells collect trailing spaces and case
 * drift across hundreds of hand edits, and an unrecognised role grants NO
 * ACCESS — so one stray space would silently lock a person out.
 */
function norm(role) {
  return String(role || '').replace(/\s+/g, ' ').trim().toLowerCase()
}
function isRole(role, candidates) {
  const n = norm(role)
  return candidates.some(c => norm(c) === n)
}

export const isManager   = role => isRole(role, [ROLE.MANAGER])
export const isFullOps   = role => isRole(role, FULL_OPS)
export const isCollector = role => isRole(role, COLLECTOR_ROLES)
export const isKnownRole = role => isRole(role, ALL_ROLES)

/** May this role sign in with an HR-code alone? Collectors only. */
export const canUseHrCodeLogin = role => isCollector(role)

/**
 * The capability set for a role. One object, so every screen asks the same
 * question instead of re-deriving access from the role string and drifting
 * apart over time.
 *
 * An unknown or empty role grants NOTHING. That is deliberate: a typo in the
 * sheet must fail closed rather than fall through to some default.
 */
export function capabilities(role, overrides) {
  const manager   = isManager(role)
  const fullOps   = isFullOps(role)
  const collector = isCollector(role)
  const operator  = manager || fullOps

  const base = {
    role: isKnownRole(role) ? String(role).trim() : null,
    known: isKnownRole(role),

    // modes
    scout:      operator,
    audit:      operator,
    tag:        operator || collector,   // collectors collect; that is the job
    comparison: operator,

    // Tag mode: only operators may record a model answer, because it becomes
    // the reference every collector is then scored against
    modelAnswer: operator,

    // Drill
    drillCreate:     operator,   // create, edit, publish, assign
    drillTake:       operator || collector,
    drillDashboards: operator,

    // admin page and update approval — Batch Manager only
    admin:            manager,
    approveUpdates:   manager,
    editQuizSettings: manager,
    // the other operator roles can SEE quiz settings but not change them
    viewQuizSettings: operator,
  }

  // ── Role Access Manager overrides ───────────────────────────────────────
  // A Batch Manager can retune any permission from the admin page; those
  // choices live in the role_access tab and arrive here as `overrides`.
  //
  // Only keys PRESENT in overrides are applied, so a half-filled row or a new
  // permission the sheet has never heard of keeps its default rather than
  // silently becoming false.
  if (!overrides) return base
  const out = { ...base }
  Object.entries(overrides).forEach(([k, v]) => {
    if (k in base && typeof v === 'boolean') out[k] = v
  })

  // A Batch Manager's admin access is NOT editable. Unchecking it would remove
  // the only route back into the matrix and lock the organisation out of its
  // own access control, with no way to repair it from inside the app.
  if (manager) out.admin = true

  return out
}

// ── Backward-compatible shims ───────────────────────────────────────────────
// Seven files call these. They keep working, so this does not have to land as
// one enormous commit, but each now answers from the ROLE rather than the email
// domain. `role` is optional; without it they deny elevated access rather than
// granting it on a domain match.

/**
 * CRITICAL — why these fall back to the domain check.
 *
 * All seven callers currently pass only `profile`; the role is not yet plumbed
 * through from the sheet to every screen. With no role, capabilities() denies
 * everything, which would have stripped Scout, Audit and Comparison from all
 * 86 operators the moment this shipped.
 *
 * So: when a role IS supplied, the role decides. When it is NOT, behaviour is
 * exactly as before. That makes this commit a no-op for existing users and lets
 * each screen migrate to capabilities(role) one at a time, instead of the whole
 * app changing access rules in a single step.
 *
 * Remove the fallback once every caller passes a role.
 */
function domainFallback(profile) {
  const email = (profile?.email || '').toLowerCase()
  return INTERNAL_DOMAINS.some(d => email.endsWith('@' + d))
}

/** @deprecated use capabilities(role) */
export function useInternalUser(profile, role) {
  if (role === undefined || role === null || role === '') return domainFallback(profile)
  return capabilities(role).scout
}

/** @deprecated use capabilities(role).admin */
export function useAdmin(profile, role) {
  // The hardcoded super admin stays as a bootstrap: without it, a mistake in
  // the sheet could leave nobody able to reach the admin page and repair it.
  if (profile?.email === 'ahmed.ashraf@hudl.com') return true
  if (role === undefined || role === null || role === '') return false
  return capabilities(role).admin
}

/**
 * DRILL role, unchanged in shape so DrillPage needs no edit.
 * 'creator' | 'trainee' | 'none'
 *
 * The @hudl.com requirement for creators is gone — the role is the authority.
 * Offline Quality Reviewer and Team Leader now qualify as creators too, which
 * the old two-role check excluded.
 */
export function resolveDrillRole(profile, role) {
  // DrillPage already passes the role from the sheet, so no fallback here —
  // and an unknown role must mean no DRILL access, not a domain guess.
  const c = capabilities(role)
  if (c.drillCreate) return 'creator'
  if (c.drillTake)   return 'trainee'
  return 'none'
}

export function canCreateDrill(profile, role) {
  return capabilities(role).drillCreate
}
export function canTakeDrill(profile, role) {
  return capabilities(role).drillTake
}

