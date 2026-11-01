import fs from 'node:fs'
import { attrSummary } from './eventAttrs.js'
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${!c && d ? '   [' + String(d).slice(0, 200) + ']' : ''}`) }
// the ENGINE's own function, taken from its source text and run as-is (the engine file is only read)
const src = fs.readFileSync(process.env.ENGINE_SRC || 'src/utils/compareEngine.js', 'utf8')
const m = src.match(/function attrSummary\(ev\) \{[\s\S]*?\n\}\n/)
const original = new Function(`${m[0]}; return attrSummary`)()
const ATTR = ['attr_team_side', 'attr_attacking_direction', 'attr_video', 'attr_height', 'attr_body_part', 'attr_extras', 'attr_technique', 'attr_gk_body_state', 'attr_outcome', 'attr_type', 'attr_miscommunication', 'attr_action', 'attr_location', 'attr_launch', 'attr_side', 'attr_direction', 'attr_kind', 'attr_paused', 'model_shape', 'attr_pass_end', 'attr_play_phase', 'attr_play_side']
const VALS = ['', 'BODY_RIGHT_FOOT', 'SIDE_RIGHT', 'HEIGHT_HIGH|BODY_HEAD', ' A_B | C_D ', 'NOUNDERSCORE', 'X|', '|Y', 'GK_TYPE_SAVE_WON', 'EXTRA_ONE|EXTRA_TWO|EXTRA_THREE']
let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n
let same = 0, total = 0
for (let i = 0; i < 3000; i++) {
  const ev = { session_id: 's', event_code: 'pass', video_time_ms: '1000', team: 'home' }
  ATTR.forEach(k => { if (rnd(3) === 0) ev[k] = VALS[rnd(VALS.length)] })
  total++; if (JSON.stringify(attrSummary(ev)) === JSON.stringify(original(ev))) same++
}
ok(`3000 random events: the copy and the engine's own attrSummary give identical short AND full text`, same === total, `${same}/${total}`)
ok('null / undefined event: identical', JSON.stringify(attrSummary(null)) === JSON.stringify(original(null)) && JSON.stringify(attrSummary(undefined)) === JSON.stringify(original(undefined)))
const ev = { attr_side: 'SIDE_RIGHT', attr_height: 'HEIGHT_HIGH', attr_extras: 'A_B|C_D', attr_kind: '' }
ok('a worked example: prefixes stripped in short, kept in full', attrSummary(ev).short === 'RIGHT, HIGH, B+D' && attrSummary(ev).full === 'side=SIDE_RIGHT  ·  height=HEIGHT_HIGH  ·  extras=A_B+C_D', JSON.stringify(attrSummary(ev)))
ok('an event with no attributes: empty text', attrSummary({ event_code: 'x' }).short === '' && attrSummary({ event_code: 'x' }).full === '')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
