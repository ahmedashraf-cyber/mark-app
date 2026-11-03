/**
 * guardedFirestore.js: the Firestore WRITE functions Tag uses, behind the read-only flag (see writeGuard.js).
 * Same names and arguments as firebase/firestore, so FieldPage only changes its import. Reads (getDocs, query, ...) are
 * not wrapped: view mode reads freely.
 */
import { setDoc as fsSetDoc, updateDoc as fsUpdateDoc, deleteDoc as fsDeleteDoc, writeBatch as fsWriteBatch } from 'firebase/firestore'
import { assertWritable } from './writeGuard'

export const setDoc    = (...a) => { assertWritable('a save to MARK\'s storage'); return fsSetDoc(...a) }
export const updateDoc = (...a) => { assertWritable('an update to MARK\'s storage'); return fsUpdateDoc(...a) }
export const deleteDoc = (...a) => { assertWritable('a delete in MARK\'s storage'); return fsDeleteDoc(...a) }

/** A batch is guarded twice: when it is made and when it is committed (the flag may flip in between). */
export function writeBatch(...a) {
  assertWritable('a batch write to MARK\'s storage')
  const batch = fsWriteBatch(...a)
  const commit = batch.commit.bind(batch)
  batch.commit = () => { assertWritable('a batch write to MARK\'s storage'); return commit() }
  return batch
}
