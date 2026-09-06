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
