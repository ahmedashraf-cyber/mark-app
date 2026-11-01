/**
 * hrCode.js — one definition of "the same HR-code", for the My halves screen.
 *
 * Everywhere else in MARK a code is compared after trimming, removing spaces and upper-casing, so a-1650 and
 * A-1650 are the same person. This keeps exactly that, and adds two things that cannot merge two different people:
 *   - a typographic dash (en dash, em dash, minus sign, non-breaking hyphen, full-width hyphen: what a Sheet or a
 *     paste turns a hyphen into) counts as a normal hyphen
 *   - invisible characters (zero-width space, non-breaking space, BOM) are removed
 * It does NOT make A1650 equal A-1650: those could be different people, and guessing would show one collector
 * another collector's halves.
 */
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g
const BLANKS = /[\s\u00A0\u200B-\u200D\u2060\uFEFF]/g

export const canonHr = v => String(v ?? '').normalize('NFKC').replace(DASHES, '-').replace(BLANKS, '').toUpperCase()

/** True when both are the same, non-empty code. An empty code never matches anything, not even another empty one. */
export const sameHr = (a, b) => { const x = canonHr(a); return x !== '' && x === canonHr(b) }
