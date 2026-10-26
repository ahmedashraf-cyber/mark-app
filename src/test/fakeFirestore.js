// In-memory stand-in for the parts of firebase/firestore the app uses, with the failure modes the
// real SDK has and the app must survive: slow writes, an offline queue that settles later, and
// rejected writes. It is only ever imported by tests (through vi.mock).
export const FS = {
  store: new Map(),            // collection -> Map(id -> data)
  latency: 0, offline: false, failAll: false,
  queue: [],                   // writes waiting for the network
  log: [], seq: 0,
  reset() { this.store = new Map(); this.latency = 0; this.offline = false; this.failAll = false; this.queue = []; this.log = []; this.seq = 0 },
  col(n) { if (!this.store.has(n)) this.store.set(n, new Map()); return this.store.get(n) },
  seed(col, docs) { const m = this.col(col); docs.forEach(d => m.set(d.id, d)) },
  count(col, f) { return [...this.col(col).values()].filter(f || (() => true)).length },
  goOnline() { this.offline = false; const q = this.queue; this.queue = []; q.forEach(fn => fn()) },
}
const wait = ms => new Promise(r => setTimeout(r, ms))
export const collection = (db, name) => ({ __col: name })
export const doc = (x, ...segs) => (x && x.__col ? { __col: x.__col, id: segs[0] } : { __col: segs[0], id: segs[1] })
export const where = (field, op, val) => ({ field, op, val })
export const query = (c, ...cons) => ({ __col: c.__col, cons })
export const serverTimestamp = () => ({ __ts: true })
function netWrite(kind, ref, apply) {
  FS.log.push({ kind, col: ref.__col, id: ref.id })
  return new Promise((resolve, reject) => {
    const run = async () => {
      if (FS.latency) await wait(FS.latency)
      if (FS.failAll) return reject(new Error('permission-denied (injected)'))
      apply(); resolve()
    }
    if (FS.offline) FS.queue.push(run); else run()
  })
}
export const setDoc = (ref, data) => netWrite('setDoc', ref, () => FS.col(ref.__col).set(ref.id, { ...data }))
export const addDoc = (c, data) => { const id = 'auto' + (++FS.seq); return netWrite('addDoc', { __col: c.__col, id }, () => FS.col(c.__col).set(id, { ...data })).then(() => ({ id })) }
export const updateDoc = (ref, data) => netWrite('updateDoc', ref, () => { const m = FS.col(ref.__col); if (m.has(ref.id)) m.set(ref.id, { ...m.get(ref.id), ...data }) })
export const deleteDoc = (ref) => netWrite('deleteDoc', ref, () => FS.col(ref.__col).delete(ref.id))
const run = (q) => [...FS.col(q.__col).entries()]
  .filter(([, d]) => (q.cons || []).every(c => (c.op === '==' ? d[c.field] === c.val : true)))
  .map(([id, d]) => ({ id, data: () => d, ref: { __col: q.__col, id } }))
export const getDocs = async (q) => { const docs = run(q); return { docs, forEach: f => docs.forEach(f), size: docs.length } }
export const getDocsFromServer = async (q) => { if (FS.offline) throw new Error('offline (injected)'); return getDocs(q) }
export const getDoc = async (ref) => { const d = FS.col(ref.__col).get(ref.id); return { exists: () => !!d, data: () => d, id: ref.id } }
export const writeBatch = () => { const ops = []; return { delete: ref => ops.push(ref), commit: () => netWrite('batch', { __col: 'batch', id: 'b' }, () => ops.forEach(r => FS.col(r.__col).delete(r.id))) } }
export const runTransaction = async (db, fn) => fn({ get: getDoc, set: setDoc, update: updateDoc, delete: deleteDoc })
export const onSnapshot = () => () => {}
