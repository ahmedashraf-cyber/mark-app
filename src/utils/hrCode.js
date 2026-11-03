/**
 * hrCode.js — one definition of "the same HR-code", for the read-only My halves screen ONLY.
 * (The Admin Sessions tab and every other screen keep comparing codes their own way, unchanged.)
 *
 * The rule, as specified:
 *   - trim, and upper-case, so a-1650 and ' A-1650 ' are A-1650
 *   - a typographic dash counts as a normal hyphen: what a Sheet or a paste turns "-" into
 *       U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash, U+2013 en dash, U+2014 em dash,
 *       U+2015 horizontal bar, U+2212 minus sign
 * and, as everywhere else in MARK, spaces INSIDE the code are ignored (the rest of the app has always compared codes
 * with all whitespace removed, so a code with a stray space must match here too, or a collector would see no halves
 * on this screen for a person the roster and the Admin tab both recognise).
 *
 * Deliberately NOT done:
 *   - A1650 is not A-1650: they could be different people, and a guess would show one collector another's halves.
 *   - no Unicode compatibility folding (NFKC), so full-width letters or digits are not turned into ASCII, and no
 *     stripping of invisible characters such as a zero-width space. No real case in the sheets needing either has been
 *     shown, and every character this does not understand makes a code NOT match, which fails safe (no halves shown),
 *     never the other way.
 */
const DASHES = /[\u2010-\u2015\u2212]/g

export const canonHr = v => String(v ?? '').trim().replace(DASHES, '-').replace(/\s+/g, '').toUpperCase()

/** True when both are the same, non-empty code. An empty code never matches anything, not even another empty one. */
export const sameHr = (a, b) => { const x = canonHr(a); return x !== '' && x === canonHr(b) }
