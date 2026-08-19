/**
 * migratePressureErrorTypes.js
 *
 * One-time idempotent migration: records saved with error type
 * 'missing_pressure' or 'extra_pressure' (v7.8.27 only, now removed) are
 * migrated to 'missing_event' and 'extra_event' respectively, preserving
 * any pressureShape value already collected.
 *
 * Idempotent: records already migrated (extras[0] !== 'missing_pressure'
 * and !== 'extra_pressure') are skipped — re-running is always safe.
 *
 * Call with db and writeBatch from firebase/firestore.
 * Returns { found, migrated } counts.
 */
export async function migratePressureErrorTypes(db) {
  const { collection, query, where, getDocs, writeBatch } = await import('firebase/firestore')

  const MIGRATION_MAP = {
    missing_pressure: 'missing_event',
    extra_pressure:   'extra_event',
  }

  // Find all records with the obsolete error types
  // extras[0] holds the error type id — query both types
  const results = await Promise.all([
    getDocs(query(collection(db, 'mark_error_tags'), where('extras', 'array-contains', 'missing_pressure'))),
    getDocs(query(collection(db, 'mark_error_tags'), where('extras', 'array-contains', 'extra_pressure'))),
  ])

  const docsToMigrate = []
  results.forEach(snap => snap.forEach(d => {
    // Deduplicate (a doc can't match both, but guard anyway)
    if (!docsToMigrate.find(x => x.id === d.id)) docsToMigrate.push(d)
  }))

  console.log(`[MARK migration] Found ${docsToMigrate.length} records with obsolete pressure error types`)

  if (docsToMigrate.length === 0) {
    return { found: 0, migrated: 0 }
  }

  // Batch update in chunks of 500 (Firestore limit)
  const CHUNK = 500
  let migrated = 0
  for (let i = 0; i < docsToMigrate.length; i += CHUNK) {
    const batch = writeBatch(db)
    const chunk = docsToMigrate.slice(i, i + CHUNK)
    chunk.forEach(d => {
      const data = d.data()
      const extras = [...(data.extras || [])]
      // Replace obsolete type with correct type (extras[0] is the error type)
      const newType = MIGRATION_MAP[extras[0]]
      if (!newType) return // already migrated or unknown — skip
      extras[0] = newType
      batch.update(d.ref, { extras, _migratedFrom: data.extras[0], _migratedAt: new Date().toISOString() })
    })
    await batch.commit()
    migrated += chunk.length
    console.log(`[MARK migration] Migrated ${migrated}/${docsToMigrate.length}`)
  }

  return { found: docsToMigrate.length, migrated }
}
