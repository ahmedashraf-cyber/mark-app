// ownerMatch.js: the one rule for "is this saved half mine?". SYNTHETIC identities only.
import { matchOwner, identityOf, canIdentify, ownerKey, normEmail, firestoreOwnerAllows, MATCHED_BY_TEXT, UNIDENTIFIED_NOTICE } from './ownerMatch.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 200) + ']' : ''}`) }
const J = JSON.stringify
const m = (id, row) => matchOwner(id, row)

console.log('the row has an email: ONLY the email decides')
ok('the account email matches although the HR-code differs: it opens, matched by email', J(m({ email: 'ali@x.com', hrCode: 'A-1' }, { email: 'ali@x.com', hrCode: 'A-999' })) === '{"match":true,"by":"email"}')
ok('case and surrounding spaces in either email do not matter', m({ email: ' ALI@X.com ', hrCode: '' }, { email: 'ali@x.COM  ', hrCode: '' }).match === true)
ok('ANOTHER account with the SAME HR-code as the row does NOT open it when the row has a different email', J(m({ email: 'bob@x.com', hrCode: 'A-999' }, { email: 'ali@x.com', hrCode: 'A-999' })) === '{"match":false,"by":null}')
ok('...even if the HR-codes are identical in every way', m({ email: 'bob@x.com', hrCode: ' a-999 ' }, { email: 'ali@x.com', hrCode: 'A-999' }).match === false)
ok('a person with NO email never matches a row that has one, whatever the code', m({ email: '', hrCode: 'A-999' }, { email: 'ali@x.com', hrCode: 'A-999' }).match === false)
ok('email and HR-code both agree (a normal collector): matched by email', J(m({ email: 'c@x.com', hrCode: 'A-5' }, { email: 'c@x.com', hrCode: 'A-5' })) === '{"match":true,"by":"email"}')

console.log('\nthe row has NO email: the HR-code, with the same normaliser as before')
ok('same code: matched by HR-code', J(m({ email: 'ali@x.com', hrCode: 'A-7' }, { email: '', hrCode: 'A-7' })) === '{"match":true,"by":"hr"}')
ok('the old normaliser still applies: case, inner spaces, typographic dashes', m({ email: 'a@x.com', hrCode: 'a - 7' }, { email: '', hrCode: 'A\u20107' }).match === true)
ok('different code: no match', m({ email: 'a@x.com', hrCode: 'A-7' }, { email: '', hrCode: 'A-8' }).match === false)
ok('a row with no email and no code matches nobody', m({ email: 'a@x.com', hrCode: 'A-7' }, { email: '', hrCode: '' }).match === false)
ok('a person with no HR-code cannot match a row that has no email (nothing to compare)', m({ email: 'a@x.com', hrCode: '' }, { email: '', hrCode: 'A-7' }).match === false)
ok('whitespace-only email on the row counts as no email', m({ email: 'a@x.com', hrCode: 'A-7' }, { email: '   ', hrCode: 'A-7' }).by === 'hr')

console.log('\nthe full-access account and a roster row with no code: matched by email, never skipped')
ok('an account with only an email opens its own rows', m({ email: 'boss@x.com', hrCode: '' }, { email: 'boss@x.com', hrCode: 'A-3' }).by === 'email')
ok('...and does not open anyone else\'s', m({ email: 'boss@x.com', hrCode: '' }, { email: 'other@x.com', hrCode: 'A-3' }).match === false)
ok('...nor a row with no email (it has no HR-code to compare)', m({ email: 'boss@x.com', hrCode: '' }, { email: '', hrCode: 'A-3' }).match === false)
ok('canIdentify: email only, code only and both are identified; neither is not', canIdentify({ email: 'a@x.com', hrCode: '' }) && canIdentify({ email: '', hrCode: 'A-1' }) && canIdentify({ email: 'a@x.com', hrCode: 'A-1' }) && !canIdentify({ email: '', hrCode: '' }) && !canIdentify({ email: '  ', hrCode: ' ' }) && !canIdentify(null))
ok('a missing or malformed identity or row never throws and never matches', m(null, null).match === false && m(undefined, { email: 'a@x.com' }).match === false && m({}, {}).match === false)

console.log('\nhelpers')
ok('identityOf normalises the email and trims the code', J(identityOf({ email: ' A@X.com ', hrCode: ' A-1 ' })) === '{"email":"a@x.com","hrCode":"A-1"}' && J(identityOf()) === '{"email":"","hrCode":""}')
ok('normEmail', normEmail('  A@B.C ') === 'a@b.c' && normEmail(null) === '')
ok('ownerKey: the email when there is one, else the canonical code, else empty', ownerKey({ email: ' A@X.com ', hrCode: 'A-1' }) === 'a@x.com' && ownerKey({ email: '', hrCode: ' a-1' }) === 'hr:A-1' && ownerKey({ email: '', hrCode: '' }) === '')
ok('two rows of one person with different (mis-typed) codes have the same key', ownerKey({ email: 'a@x.com', hrCode: 'A-317' }) === ownerKey({ email: 'A@x.com', hrCode: 'A-043' }))
ok('the list-line texts and the unidentified notice are fixed strings', MATCHED_BY_TEXT.email === 'matched by email' && MATCHED_BY_TEXT.hr === 'matched by HR-code' && /no email or HR-code/.test(UNIDENTIFIED_NOTICE))

console.log('\nthe Firestore copy of the owner: a second look that only refuses when it CONTRADICTS me')
const me = { email: 'ali@x.com', hrCode: 'A-1' }
ok('the record has my email: allowed, whatever code it carries', firestoreOwnerAllows({ collectorEmail: 'Ali@x.com ', collectorHrCode: 'A-999' }, me, 'email') === true)
ok('the record has ANOTHER email: refused, even if its HR-code is mine', firestoreOwnerAllows({ collectorEmail: 'bob@x.com', collectorHrCode: 'A-1' }, me, 'email') === false && firestoreOwnerAllows({ collectorEmail: 'bob@x.com', collectorHrCode: 'A-1' }, me, 'hr') === false)
ok('no email in the record, the sheet matched me by EMAIL: allowed although the record carries a different typed code (the legacy mis-typed code)', firestoreOwnerAllows({ collectorHrCode: 'A-317' }, me, 'email') === true)
ok('no email in the record, the sheet matched me by HR-code: the record\'s code must be mine', firestoreOwnerAllows({ collectorHrCode: ' a-1 ' }, me, 'hr') === true && firestoreOwnerAllows({ collectorHrCode: 'A-2' }, me, 'hr') === false)
ok('no record at all: allowed (the sheet row decided)', firestoreOwnerAllows(null, me, 'email') === true && firestoreOwnerAllows(undefined, me, 'hr') === true)
ok('a record with neither email nor code: allowed', firestoreOwnerAllows({}, me, 'hr') === true)
ok('a person with no email cannot pass a record that carries an email', firestoreOwnerAllows({ collectorEmail: 'ali@x.com' }, { email: '', hrCode: 'A-1' }, 'hr') === false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
