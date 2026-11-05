/**
 * Firestore mirror of synced leads. Postgres is the source of truth; the
 * mirror is derived data. A mirror failure therefore NEVER fails or rolls back
 * a sync, and any drift can be repaired from Postgres at any time.
 */

import { getFirebaseAdminFirestore } from '@/lib/firebase-admin'
import { logger } from '@/lib/utils/logger'
import { hashRecord } from './engine'
import type { LeadSnapshot } from './lead-sync'

const BATCH_SIZE = 400
const MAX_RECONCILE = 5000

const collectionPath = (org: string) => `organisations/${org}/leads`

export async function mirrorLeads(org: string, leads: LeadSnapshot[]): Promise<{ ok: boolean; error?: string }> {
  if (leads.length === 0) return { ok: true }
  try {
    const firestore = getFirebaseAdminFirestore()
    for (let i = 0; i < leads.length; i += BATCH_SIZE) {
      const batch = firestore.batch()
      for (const lead of leads.slice(i, i + BATCH_SIZE)) {
        batch.set(firestore.collection(collectionPath(org)).doc(lead.leadNumber), {
          ...lead.record,
          leadNumber: lead.leadNumber,
          archived: lead.deletedAt !== null,
          hash: hashRecord(lead.record),
          updatedAt: lead.updatedAt.toISOString(),
          syncedAt: new Date().toISOString(),
        })
      }
      await batch.commit()
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'mirror failed'
    logger.error('Firestore mirror write failed', { org, error: message })
    return { ok: false, error: message }
  }
}

export interface ReconcileReport {
  postgresLeads: number
  firestoreDocs: number
  missingInFirestore: string[]
  outdatedInFirestore: string[]
  orphanedInFirestore: string[]
  truncated: boolean
  repaired: number
}

/**
 * Compare Postgres against the Firestore mirror. With `repair`, rewrites the
 * mirror from Postgres (never the other direction) for anything that differs.
 */
export async function reconcileMirror(
  org: string,
  loadLeads: (take: number) => Promise<LeadSnapshot[]>,
  options: { repair?: boolean } = {}
): Promise<ReconcileReport> {
  const leads = await loadLeads(MAX_RECONCILE + 1)
  const truncated = leads.length > MAX_RECONCILE
  const scoped = leads.slice(0, MAX_RECONCILE)

  const firestore = getFirebaseAdminFirestore()
  const snapshot = await firestore.collection(collectionPath(org)).get()
  const mirrored = new Map(snapshot.docs.map(doc => [doc.id, doc.data() as { hash?: string }]))

  const missing: string[] = []
  const outdated: string[] = []
  const needsRepair: LeadSnapshot[] = []
  for (const lead of scoped) {
    const doc = mirrored.get(lead.leadNumber)
    if (!doc) { missing.push(lead.leadNumber); needsRepair.push(lead) }
    else if (doc.hash !== hashRecord(lead.record)) { outdated.push(lead.leadNumber); needsRepair.push(lead) }
  }
  const known = new Set(scoped.map(l => l.leadNumber))
  const orphaned = [...mirrored.keys()].filter(id => !known.has(id))

  let repaired = 0
  if (options.repair && needsRepair.length) {
    const result = await mirrorLeads(org, needsRepair)
    if (result.ok) repaired = needsRepair.length
  }

  return {
    postgresLeads: scoped.length,
    firestoreDocs: mirrored.size,
    missingInFirestore: missing,
    outdatedInFirestore: outdated,
    orphanedInFirestore: orphaned,
    truncated,
    repaired,
  }
}
