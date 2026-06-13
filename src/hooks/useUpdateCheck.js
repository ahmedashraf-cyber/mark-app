// Checks GitHub Releases for a newer version on app startup
// Shows a banner if update is available

const REPO = 'ahmedashraf-cyber/mark-app'
export const CURRENT_VERSION = '7.0.0' // matches package.json version

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
