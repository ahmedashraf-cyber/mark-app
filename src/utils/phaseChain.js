/**
 * phaseChain.js — the "All events" phase engine
 * ============================================================================
 * Pure functions. No React, no state, no network. Used ONLY by the "All events"
 * collection method; "Not all events" never imports this file.
 *
 * ── The one design decision that keeps this safe ───────────────────────────
 * The Mark Chain rules are written in the DOCUMENT's vocabulary ("field outcome
 * is won", "goal-keeper", "pass field type is first-time"). MARK stores events
 * in its own (OUTCOME_WON, goal_keeper, a separate pass_first_time event).
 *
 * Rather than translating 157 rule strings into MARK's names — 157 chances to
 * mistranslate one and make a phase silently unreachable — each EVENT is
 * translated into the document's vocabulary, once, by toDocEvent(). The rules
 * in phaseRules.js are then evaluated exactly as written, never altered.
 *
 * ── The phase is never stored ──────────────────────────────────────────────
 * runChain() recomputes every phase from the events. Nothing can drift out of
 * step after an edit, delete, undo or reload, because the events are the only
 * source.
 */
import {
  rules as MAIN_RULES, pressureRoomRules, transparent, always, pressureRoomTransparent,
} from './phaseRules'

// ════════════════════════════════════════════════════════════════════════════
// 1. VOCABULARY — MARK event → the document's vocabulary
// ════════════════════════════════════════════════════════════════════════════

/** MARK event ids that the document calls by another name. */
const DOC_EVENT_NAME = {
  // The document has ONE pass event and tells them apart by type. MARK has four
  // separate events. All four are "pass" to the document; toDocEvent supplies
  // the distinguishing type.
  pass: 'pass', pass_first_time: 'pass', pass_interception: 'pass', pass_recovery: 'pass',
}
const docEventName = markId => DOC_EVENT_NAME[markId] || String(markId).replace(/_/g, '-')

/** The type a MARK pass-family event implies, in document words. */
const PASS_EVENT_TYPE = {
  pass_first_time: 'first-time', pass_interception: 'interception', pass_recovery: 'recovery',
}

/**
 * MARK codes whose document spelling is not a mechanical rename. Everything
 * else is derived by stripping the prefix and lower-casing: OUTCOME_WON → won.
 */
const VALUE_OVERRIDE = {
  FOUL_DANGEROUS: 'dangerous-play', FOUL_SIX_SEC: 'six-seconds',
  FOUL_EIGHT_SEC: 'eight-seconds', FOUL_BACKPASS: 'backpass-pick',
  FOUL_FOUL_OUT: 'foul-out',
  GK_TYPE_SAVE_ATTEMPT: 'save-attempt', GK_TYPE_CONCEDED_NO_SAVE: 'conceded-no-save',
  TYPE_GK_DIST: 'gk-distribution',
  OUT_FROM_PASS: 'pass',
}

const PREFIXES = ['GK_TYPE_', 'OUTCOME_', 'SHOT_TYPE_', 'LOC_', 'TYPE_', 'TECH_',
  'EXTRA_', 'FOUL_', 'CARD_', 'SIDE_', 'BODY_', 'MISC_', 'GK_BODY_', 'GK_STANCE_',
  'OUT_', 'RECEPTION_']

export function docValue(code) {
  const c = String(code || '').trim()
  if (!c) return ''
  if (VALUE_OVERRIDE[c]) return VALUE_OVERRIDE[c]
  const p = PREFIXES.find(x => c.startsWith(x))
  return (p ? c.slice(p.length) : c).toLowerCase().replace(/_/g, '-')
}

/**
 * Per event, which MARK group feeds which DOCUMENT field. Only the mismatches
 * found by the vocabulary report are listed; every other group keeps its name.
 */
const FIELD_REMAP = {
  block:       { extras: 'outcome' },        // deflection is a block extra in MARK
  dribble:     { outcome: 'type' },          // overrun is a dribble outcome in MARK
  shot:        { outcome: 'type', shot_type: 'type' },
  goal_keeper: { technique: 'outcome' },     // claim / clear are GK technique in MARK
  out:         { out_from: 'type' },
  reception:   {},
}

/** GK codes that pack a type AND an outcome into one value. */
const GK_COMBINED = {
  GK_TYPE_SAVE_WON:     { type: 'save', outcome: 'won' },
  GK_TYPE_SAVE_SUCCESS: { type: 'save', outcome: 'success' },
}

/**
 * Translate one MARK event into the document's shape:
 *   { event, team:'mine'|'opponent', part, fields:{ field:Set<value> } }
 *
 * `groups` is FIELD's [{ groupId, selections:[{code}] }]. The derived fields —
 * pass-end, phase, side — are added by runChain, which has the context they
 * need; they are not stored attributes.
 */
export function toDocEvent(markEvent, { team, part }) {
  const id = markEvent.code
  const fields = {}
  const add = (f, v) => { if (!v) return; (fields[f] ||= new Set()).add(v) }

  ;(markEvent.groups || []).forEach(g => {
    const target = (FIELD_REMAP[id] || {})[g.groupId] || g.groupId
    ;(g.selections || []).forEach(s => {
      const combo = id === 'goal_keeper' && GK_COMBINED[s.code]
      if (combo) { add('type', combo.type); add('outcome', combo.outcome); return }
      add(target, docValue(s.code))
    })
  })

  // the pass-family event itself implies a type
  if (PASS_EVENT_TYPE[id]) add('type', PASS_EVENT_TYPE[id])
  // a plain pass carries its type from the pass-type step (TYPE_KICK_OFF …)
  if (id === 'pass' && markEvent.passType) add('type', docValue(markEvent.passType))

  // ball recovery: the document's "fail" is MARK's "incomplete"
  if (id === 'ball_recovery' && fields.outcome?.has('incomplete')) {
    fields.outcome.delete('incomplete'); fields.outcome.add('fail')
  }
  // reception: complete is derived, never asked. Offside is not a reception at
  // all — it is tagged as a Foul with type offside, so a reception is complete.
  if (id === 'reception') add('outcome', 'complete')

  return { event: docEventName(id), markId: id, team, part, fields }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. COMPILER — rule string → predicate, built once
// ════════════════════════════════════════════════════════════════════════════

const OPS = ['is not one of', 'is one of', 'does not have', 'does have', 'is not', 'is']

/** Parse one rule. Throws on anything it cannot read — nothing fails silently. */
export function parseRule(rule) {
  // the document joins conditions with "and", and sometimes with a comma
  const segs = String(rule).replace(/,\s*and\s+/g, ' and ').replace(/,\s*/g, ' and ')
    .split(/\s+and\s+/).map(s => s.trim()).filter(Boolean)
  const head = segs[0].split(/\s+/)
  const event = head[0]
  const conds = []
  const rest = [head.slice(1).join(' '), ...segs.slice(1)].filter(Boolean)
  for (const seg of rest) {
    let m
    if ((m = seg.match(/^team is (mine|opponent)$/))) { conds.push({ kind:'team', value:m[1] }); continue }
    if ((m = seg.match(/^part is (not )?(\d+)$/)))     { conds.push({ kind:'part', not:!!m[1], value:+m[2] }); continue }
    if ((m = seg.match(/^field (\S+) (.+)$/))) {
      const op = OPS.find(o => m[2].startsWith(o + ' '))
      if (!op) throw new Error(`Unreadable condition "${seg}" in rule: ${rule}`)
      const values = m[2].slice(op.length).trim().split(/\s+/)
      conds.push({ kind:'field', field:m[1], op, values })
      continue
    }
    throw new Error(`Unreadable condition "${seg}" in rule: ${rule}`)
  }
  return { event, conds, source: rule }
}

function testCond(c, ev) {
  if (c.kind === 'team') return ev.team === c.value
  if (c.kind === 'part') return c.not ? ev.part !== c.value : ev.part === c.value
  const have = ev.fields[c.field] || new Set()
  const any = c.values.some(v => have.has(v))
  switch (c.op) {
    // "is" and "does have" both mean the field holds the value; the document
    // uses "is" for single answers and "does have" for multi-select
    case 'is': case 'does have': case 'is one of': return any
    case 'is not': case 'does not have': case 'is not one of': return !any
    default: return false
  }
}

export const compile = rule => {
  const p = parseRule(rule)
  return { ...p, test: ev => ev.event === p.event && p.conds.every(c => testCond(c, ev)) }
}

const compileMachine = m => Object.fromEntries(Object.entries(m).map(([k, v]) =>
  [k, { rules: v.rules.map(compile), postRules: v.postRules.map(compile) }]))

export const MAIN = compileMachine(MAIN_RULES)
export const PRESSURE = compileMachine(pressureRoomRules)
const TRANSPARENT = transparent.map(compile)
const ALWAYS = always.map(compile)
const PRESSURE_TRANSPARENT = new Set(pressureRoomTransparent)

// ════════════════════════════════════════════════════════════════════════════
// 3. DERIVED FIELDS
// ════════════════════════════════════════════════════════════════════════════

/** Events that say nothing about the ball, skipped when finding "the next ball event". */
const NON_BALL = new Set(['card', 'pressure_start', 'pressure_end', 'camera_on', 'camera_off'])

const ATTACKING_IS_MINE = { flightO:true, shotFlightO:true, carry:true, looseO:true,
  flightD:false, shotFlightD:false, defense:false, looseD:false }

/** A foul's phase field: carry or defense when a team had the ball, else uncontrolled. */
const foulPhaseFor = phase =>
  phase === 'carry' ? 'carry' : phase === 'defense' ? 'defense' : 'uncontrolled'

// ════════════════════════════════════════════════════════════════════════════
// 4. THE CHAIN
// ════════════════════════════════════════════════════════════════════════════

/**
 * How specific a rule is: the number of POSITIVE conditions — ones that name a
 * particular value (`is`, `does have`, `is one of`, `part is N`). Conditions
 * that only exclude (`is not`, `does not have`, `part is not N`) do not count.
 */
const specificity = r => r.conds.filter(c =>
  (c.kind === 'field' && ['is', 'does have', 'is one of'].includes(c.op)) ||
  (c.kind === 'part' && !c.not)).length

/**
 * The phase this event moves the chain into.
 *
 * NOT simply the first match in document order. The ambiguity check found two
 * events that satisfy two phases' entry rules at once:
 *
 *   an opponent's shot during penalties
 *       shotFlightD  'shot team is opponent'
 *       keeper       'shot team is opponent and part is 5'
 *   an eight-seconds foul by the opponent
 *       restartEightSeconds  'foul-committed field type is eight-seconds …'
 *       restartFoul          '… field type is not foul-out …'
 *
 * Document order picks shotFlightD for the first — so the keeper phase could
 * never be reached in a shootout — and happens to pick correctly for the
 * second. Counting conditions fails too: restartFoul has more of them.
 *
 * The rule that NAMES the specific thing (part is 5, type is eight-seconds)
 * should win over one that only excludes things (is not foul-out). So the most
 * positive conditions wins; a tie falls back to document order.
 */
function nextPhase(machine, ev) {
  let best = null, bestScore = -1
  for (const [name, p] of Object.entries(machine)) {
    for (const r of p.rules) {
      if (!r.test(ev)) continue
      const score = specificity(r)
      if (score > bestScore) { best = name; bestScore = score }
    }
  }
  return best
}

/**
 * Run the chain over a half.
 *
 * events: [{ code, team:'mine'|'opponent', groups, passType? }] in time order
 * Returns one entry per event:
 *   { phaseBefore, phaseAfter, pressureBefore, pressureAfter, valid, docEvent }
 */
export function runChain(events, { part = 1 } = {}) {
  let phase = 'preHalf', pressure = 'preHalf'
  let lastBall = null                       // the last ball event, for pass-end
  const out = []

  events.forEach(raw => {
    const ev = toDocEvent(raw, { team: raw.team, part })

    // ── derived fields, from the context runChain alone can see ──
    // pass-end: completion of the pass this event ends. Complete only when a
    // TEAMMATE receives it; any foul — including an offside, which the passer's
    // own team commits — means the pass was never received. The one exception
    // is a foul played with advantage, handled below.
    // A foul played with ADVANTAGE does not stop play — the ball carries on and
    // the next real event decides whether the pass was completed. So it is
    // treated like a non-ball event: it neither ends the pass nor becomes the
    // last ball event.
    const advantagePlayed = raw.code === 'foul_committed' && ev.fields.outcome?.has('advantage')
    const skipsBall = NON_BALL.has(raw.code) || advantagePlayed

    if (lastBall && lastBall.event === 'pass' && !skipsBall) {
      const received = raw.team === lastBall.team && raw.code !== 'foul_committed'
      ev.fields['pass-end'] = new Set([received ? 'complete' : 'incomplete'])
    }
    // out "from a pass": derived, never asked. The document requires it in
    // flightO (a pass is in the air, so an out there IS from a pass) and forbids
    // it in looseO/looseD (a loose ball is not a pass). That is exactly "was the
    // ball event before this one a pass" — the same logic as pass-end. As a
    // question it would offer a single possible answer in each phase.
    if (raw.code === 'out' && lastBall && lastBall.event === 'pass') {
      (ev.fields.type ||= new Set()).add('pass')
    }
    if (raw.code === 'foul_committed') ev.fields.phase = new Set([foulPhaseFor(phase)])
    if (raw.code === 'block' && phase in ATTACKING_IS_MINE) {
      const blockerAttacking = (raw.team === 'mine') === ATTACKING_IS_MINE[phase]
      ev.fields.side = new Set([blockerAttacking ? 'offense' : 'defense'])
    }

    // ── main chain ──
    const isTransparent = TRANSPARENT.some(r => r.test(ev))
    const post = MAIN[phase]?.postRules || []
    const valid = isTransparent
      || ALWAYS.some(r => r.test(ev))
      // An EMPTY postRules list means no restriction, not "nothing allowed".
      // idle is the only main phase with one, and it is the phase while the
      // opponent restarts after MY team put the ball out or fouled. Reading []
      // as "block everything" would deadlock the chain there every time — the
      // opponent's restart could not even be tagged — yet the document's own
      // transitions lead straight out of idle. So [] = unrestricted.
      || post.length === 0
      || post.some(r => r.test(ev))
    const before = phase
    if (!isTransparent) {
      const n = nextPhase(MAIN, ev)
      if (n) phase = n
    }

    // ── pressure chain, in parallel ──
    const pBefore = pressure
    if (!PRESSURE_TRANSPARENT.has(ev.event)) {
      const n = nextPhase(PRESSURE, ev)
      if (n) pressure = n
    }

    if (!skipsBall) lastBall = { event: ev.event, team: raw.team }
    out.push({ phaseBefore: before, phaseAfter: phase,
      pressureBefore: pBefore, pressureAfter: pressure, valid, docEvent: ev })
  })
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// 5. INFERENCE — the confirmed phase × event table
// ════════════════════════════════════════════════════════════════════════════

const M = 'mine', O = 'opponent', A = 'ask', N = 'none'
const NO_TEAM = ['stoppage', 'end_stoppage', 'half_end', 'match_status',
  'camera_on', 'camera_off', 'unknown_pass_end']

/**
 * Who performs each kind of action, taken from the confirmed table — not a new
 * list. carry is when MY team has the ball, so its entries are what the team
 * WITH the ball does; defense is when the OPPONENT has it, so its entries are
 * what the team WITHOUT the ball does.
 */
const WITH_BALL    = ['pass', 'shot', 'dribble', 'miscontrol', 'hold_up_duel', 'separation_duel']
const WITHOUT_BALL = ['tackle', 'leg_stretch_duel', 'goal_keeper']
const assign = (ids, who) => Object.fromEntries(ids.map(id => [id, who]))

/**
 * Pass in the air. From the confirmed Flight O / Flight D tables: Flight O's
 * inferred events are done by the PASSING team, Flight D's by the OTHER team.
 * Out and Own goal against follow the confirmed Flight O decisions — the
 * passer put it out; a defender turned it into their own net.
 */
const FLIGHT_PASSER = ['reception', 'pass_first_time', 'shot', 'miscontrol', 'out']
const FLIGHT_OTHER  = ['goal_keeper', 'clearance', 'interception', 'ball_recovery',
  'pass_interception', 'pass_recovery', 'own_goal_against']

/** Shot in the air, from the confirmed Shot Flight tables. */
const SHOT_SHOOTER = ['end_shot', 'shot']          // shot = Shot Redirect
const SHOT_OTHER   = ['goal_keeper']

/**
 * phase → { MARK event id → decision }. Anything unlisted asks.
 *
 * Both teams are collected, so an action by EITHER team can occur in carry or
 * defense. A tackle while my team has the ball is the opponent's tackle, not an
 * impossible event — and its outcome then moves the chain (a won tackle takes
 * it to defense). So each of the two possession phases lists BOTH teams'
 * actions: the team with the ball does WITH_BALL, the other does WITHOUT_BALL.
 */
const TABLE = {
  newHalf:   { pass:M, shot:M },
  // my team has the ball
  carry:     { ...assign(WITH_BALL, M), ...assign(WITHOUT_BALL, O) },
  // the opponent has the ball
  defense:   { ...assign(WITHOUT_BALL, M), ...assign(WITH_BALL, O),
               // Error is not highlighted in the Defence table: it is MY team's
               // error, like every other event in that column (confirmed)
               error:M },
  // my pass in the air. Ask ONLY on the contested events from the Flight O
  // table (block, foul, hold-up duel, positioning duel, shield, error); every
  // other event is inferred:
  //   out              — nobody else touched it (that would be a block or an
  //                      interception first), so MY team put it out
  //   own goal against — a defender turned my pass into their own net, so it is
  //                      the OPPONENT's; the document then sends the chain to
  //                      idle with the opponent kicking off
  // ── pass in the air ─────────────────────────────────────────────────────
  // Symmetric, like carry/defense: each flight phase lists what the PASSING
  // team does and what the OTHER team does, so the same event resolves for
  // whichever team it belongs to. Before this, each phase was written from one
  // side only — a reception after the opponent's pass, or a ball recovery
  // after mine, fell through to asking.
  //   - reception and first-time pass inherit the passer (the passing team)
  //   - a ball recovery right after a pass is the OTHER team's
  flightO:   { ...assign(FLIGHT_PASSER, M), ...assign(FLIGHT_OTHER, O) },
  flightD:   { ...assign(FLIGHT_PASSER, O), ...assign(FLIGHT_OTHER, M) },

  // ── shot in the air ─────────────────────────────────────────────────────
  shotFlightO: { ...assign(SHOT_SHOOTER, M), ...assign(SHOT_OTHER, O) },
  shotFlightD: { ...assign(SHOT_SHOOTER, O), ...assign(SHOT_OTHER, M) },
  restartThrow:{ pass:M, shot:M }, restartGkCorner:{ pass:M, shot:M },
  restartFoul: { pass:M, shot:M }, restartFoulOut: { pass:M, shot:M },
  restartKickoff:{ pass:M, shot:M }, restartEightSeconds:{ pass:M, shot:M },
  idle:      { pass:O, shot:O },
  keeper:    { goal_keeper:M },
  // loose ball, my team likely to recover. Every event asks (all highlighted)
  // except Own goal against, which is the OPPONENT's — as in Flight O (confirmed)
  looseO:    { own_goal_against:O },
  // mirror of Loose O: own goal during the opponent's likely recovery is mine
  looseD:    { own_goal_against:M },
}

/**
 * How the team of an event is decided in a phase:
 *   'mine' | 'opponent' — inferred, no prompt
 *   'ask'               — the Home/Away prompt appears
 *   'none'              — the event has no team
 *
 * Pressure start is inferred from the main phase: the team WITHOUT the ball is
 * pressing. With no team in possession, it asks.
 */
/**
 * Events that ASK in a phase even though they have no team everywhere else.
 * In both Loose tables, Stoppage and Half End are highlighted: during a loose
 * ball the collector says which team they relate to.
 */
const ASK_OVERRIDE = {
  looseO: ['stoppage', 'half_end'],
  looseD: ['stoppage', 'half_end'],
}

export function teamDecision(phase, markId) {
  // checked BEFORE the no-team list, which would otherwise hide these
  if ((ASK_OVERRIDE[phase] || []).includes(markId)) return A
  if (NO_TEAM.includes(markId)) return N
  if (markId === 'pressure_start' || markId === 'pressure_end') {
    if (phase in ATTACKING_IS_MINE) return ATTACKING_IS_MINE[phase] ? O : M
    return A
  }
  return (TABLE[phase] || {})[markId] || A
}

// ════════════════════════════════════════════════════════════════════════════
// 6. KEY GATE — is this key allowed right now?
// ════════════════════════════════════════════════════════════════════════════

/**
 * NOT USED TO BLOCK KEYS. Both teams are collected, so no event is impossible in
 * a phase — an "invalid" event is simply the other team's. Kept because it
 * documents what the Mark Chain considers valid and the test exercises it.
 *
 * Could ANY answer make this event valid in this phase?
 *
 * A key press arrives before the collector has answered the event's questions,
 * so validity is judged on the event alone: allowed if some rule for this
 * phase (or always / transparent) names this event. Answers that would then
 * make it invalid are hidden by optionAllowed, so a wrong combination can never
 * be chosen.
 */
export function keyAllowed(phase, markId) {
  const name = docEventName(markId)
  const names = rs => rs.some(r => r.event === name)
  const post = MAIN[phase]?.postRules || []
  // empty postRules = unrestricted (see runChain)
  return post.length === 0 || names(post) || names(ALWAYS) || names(TRANSPARENT)
}

// ════════════════════════════════════════════════════════════════════════════
// 7. RECEPTION RULE
// ════════════════════════════════════════════════════════════════════════════

/** Every kind of pass. A reception may follow any of them. */
const PASS_FAMILY = new Set(['pass', 'pass_first_time', 'pass_interception', 'pass_recovery'])

/**
 * Events that may sit BETWEEN a pass and its reception. Only camera off/on and
 * pressure start/end — confirmed. A CARD is deliberately not here: a card
 * between the pass and the reception breaks the rule.
 */
const BETWEEN_PASS_AND_RECEPTION = new Set(['camera_off', 'camera_on', 'pressure_start', 'pressure_end'])

/**
 * May a Reception be tagged now? Only when the most recent event — skipping
 * camera off/on and pressure start/end — is a pass. Otherwise the Reception key
 * does nothing (confirmed). This is the one key All events blocks: a reception
 * with no pass before it has nothing to be the reception OF.
 *
 * eventIds: the half's MARK event ids, in order, most recent last.
 */
export function receptionAllowed(eventIds) {
  for (let i = eventIds.length - 1; i >= 0; i--) {
    const id = eventIds[i]
    if (BETWEEN_PASS_AND_RECEPTION.has(id)) continue
    return PASS_FAMILY.has(id)
  }
  return false   // nothing before it at all
}

// ════════════════════════════════════════════════════════════════════════════
// 8. TYPE QUESTIONS — which pass / shot types does the phase allow? (E)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Which of `candidateCodes` (MARK option codes for a pass TYPE or a shot TYPE)
 * does the Mark Chain allow for this event, right now?
 *
 * It evaluates the SAME compiled postRules runChain uses, so it cannot drift
 * from the chain, and it was checked against the rules rather than a hand-typed
 * table. `optionAllowed` is mentioned in a comment above but never existed;
 * this is the real thing.
 *
 *   restricted: false  — the phase says nothing (idle has no postRules), or the
 *                        team is unknown, so the caller must ask exactly as it
 *                        always did
 *   restricted: true   — `codes` are the allowed ones. Length 1 = nothing to
 *                        ask. Length 0 = the chain does not expect this event
 *                        here at all, so the caller also asks exactly as before
 *
 * relTeam is 'mine' | 'opponent' — rules such as "pass type is corner and team
 * is mine" depend on it, which is why the team has to be known first.
 */
export function validTypes(phase, markId, relTeam, part, candidateCodes) {
  const machine = MAIN[phase]
  if (!machine || !relTeam) return { restricted: false, codes: [] }
  const post = machine.postRules
  if (post.length === 0) return { restricted: false, codes: [] }
  const event = docEventName(markId)
  const codes = candidateCodes.filter(code => {
    const ev = { event, markId, team: relTeam, part, fields: { type: new Set([docValue(code)]) } }
    return post.some(r => r.test(ev))
  })
  return { restricted: true, codes }
}

// ════════════════════════════════════════════════════════════════════════════
// 9. RECEPTION — team fallback when the phase gives none (B)
// ════════════════════════════════════════════════════════════════════════════

/**
 * The team a Reception may INHERIT from the pass before it. This is only ever
 * the FALLBACK: teamDecision() is consulted first, and the phase wins whenever
 * it names a team. It is used when the phase gives none — in practice, when no
 * Half start has been tagged yet, so "mine" is unknown and nothing can be
 * inferred from the phase at all.
 *
 * Deliberately strict, because a wrong team stored as "inherited" is worse than
 * one extra question. It returns a team only when ALL of these hold:
 *   - the pass is the IMMEDIATELY preceding event. Anything between it and the
 *     reception — a card, a camera event, even a pressure event — returns null
 *   - that event is in the pass family and has a team
 *   - it is not flagged incomplete. The data model has no per-pass "incomplete"
 *     flag: pass-end is derived and stored on the event AFTER a pass. So the
 *     signal that exists is the pass event's own stored passEnd, which is
 *     'incomplete' when that pass ended the OTHER team's pass — an interception
 *     or a recovery, i.e. the ball has just changed hands
 *
 * `events` are FIELD's stored events, newest last (the same convention
 * receptionAllowed uses; neither looks at video time). Returns 'home' | 'away'
 * | null. null means ask.
 */
export function inheritedReceptionTeam(events) {
  const prev = events && events.length ? events[events.length - 1] : null
  if (!prev || !PASS_FAMILY.has(prev.eventId)) return null
  if (!prev.team) return null
  if (prev.passEnd === 'incomplete') return null
  return prev.team
}
