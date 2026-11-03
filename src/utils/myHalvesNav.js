/**
 * myHalvesNav.js: the ONE rule for "See its errors in My halves" on Tag's start screen.
 * Tag gets a handler only when the signed-in role may see its OWN halves (viewOwnHalves). Without a handler Tag shows no button, and Tag
 * double-checks the permission itself. (viewAnyHalves alone is not enough: this button is about the collector's own halves.)
 */
export const myHalvesOpener = (caps, open) => (caps && caps.viewOwnHalves && typeof open === 'function' ? open : undefined)
