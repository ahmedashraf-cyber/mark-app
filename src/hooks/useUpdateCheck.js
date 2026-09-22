// Checks GitHub Releases for a newer version on app startup
// Shows a banner if update is available

const REPO = 'ahmedashraf-cyber/mark-app'
export const CURRENT_VERSION = '7.9.8' // MUST match package.json

// NOTE: this drifted to 7.8.89 while package.json reached 7.9.8, because the
// version bump replaces the PREVIOUS number and this constant had fallen out of
// step. Every user was compared against 7.8.89, so the update banner fired even
// when they were already current. Keep it in the bump list.

function semverGt(a, b) {
  // Returns true if a > b
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

export async function checkForUpdate() {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { 'Accept': 'application/vnd.github.v3+json' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const latestVersion = data.tag_name || data.name || ''
    const cleanLatest = latestVersion.replace(/^v/, '')
    if (semverGt(cleanLatest, CURRENT_VERSION)) {
      return {
        version: cleanLatest,
        url: data.html_url,
        downloadUrl: (data.assets || []).find(a => a.name.endsWith('.msi') || a.name.endsWith('.exe'))?.browser_download_url || data.html_url,
        publishedAt: data.published_at,
      }
    }
    return null
  } catch (e) {
    return null // silent fail — no internet or API error
  }
}
