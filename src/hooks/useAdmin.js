// Super admin access — hardcoded to ahmed.ashraf@hudl.com only
export function useAdmin(profile) {
  return profile?.email === 'ahmed.ashraf@hudl.com'
}
