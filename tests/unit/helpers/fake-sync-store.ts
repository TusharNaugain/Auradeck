import type { FieldConflict, PartialSyncRecord, SyncRecord } from '@/lib/sync/engine'
import { canonicalizeFull } from '@/lib/sync/engine'
import type { LeadSnapshot, SyncStore } from '@/lib/sync/lead-sync'

/** In-memory SyncStore that enforces the same rules as the Postgres one. */
export class FakeStore implements SyncStore {
  leads = new Map<string, LeadSnapshot>()
  bases = new Map<string, PartialSyncRecord>()
  externalRefs = new Map<string, string>()
  batches = new Map<string, { status: string; result: unknown; payload: unknown }>()
  conflicts: Array<FieldConflict & { leadId: string }> = []
  rejected: Array<{ rowRef: string; reason: string }> = []
  audit: string[] = []
  priorityLeads = new Set<string>()
  private tick = 0
  private seq = 0
  failNextUpdate = false

  private now() { return new Date(1_700_000_000_000 + ++this.tick * 1000) }

  seed(record: Partial<SyncRecord>, over: Partial<LeadSnapshot> = {}): LeadSnapshot {
    const id = `id_${++this.seq}`
    const lead: LeadSnapshot = {
      id, leadNumber: `LD-${String(this.seq).padStart(6, '0')}`, updatedAt: this.now(), deletedAt: null,
      record: deriveContacted(canonicalizeFull({ firstName: 'Sam', lastName: 'Taylor', email: `sam${this.seq}@example.test`, leadSource: 'website', lifecycleStage: 'new', ...record })),
      ...over,
    }
    this.leads.set(id, lead)
    return lead
  }

  /** Simulate someone editing in the CRM. */
  crmEdit(leadNumber: string, patch: Partial<SyncRecord>) {
    const lead = [...this.leads.values()].find(l => l.leadNumber === leadNumber)!
    lead.record = deriveContacted({ ...lead.record, ...patch })
    lead.updatedAt = this.now()
  }

  async findBatch(_o: string, batchId: string) { return this.batches.get(batchId) ?? null }
  async saveBatch(_o: string, batchId: string, payload: unknown) {
    if (!this.batches.has(batchId)) this.batches.set(batchId, { status: 'received', result: null, payload })
  }
  async finishBatch(_o: string, batchId: string, status: string, result: unknown) {
    this.batches.set(batchId, { ...this.batches.get(batchId)!, status, result })
  }
  async findLeadByNumber(_o: string, n: string) { return [...this.leads.values()].find(l => l.leadNumber === n) ?? null }
  async findLeadByExternalRef(_o: string, ref: string) {
    const id = this.externalRefs.get(ref)
    return id ? this.leads.get(id) ?? null : null
  }
  async findDuplicate(_o: string, m: { email: string | null; phone: string | null }, exclude?: string) {
    const hit = [...this.leads.values()].find(l =>
      !l.deletedAt && l.id !== exclude &&
      ((m.email && l.record.email === m.email) || (m.phone && l.record.phone === m.phone)))
    return hit?.leadNumber ?? null
  }
  async getBase(_o: string, id: string) { return this.bases.get(id) ?? null }
  async createLead(_o: string, { record, externalRef, isPriority }: { record: SyncRecord; externalRef: string; isPriority?: boolean }) {
    const lead = this.seed(record)
    if (isPriority) this.priorityLeads.add(lead.id)
    this.externalRefs.set(externalRef, lead.id)
    this.bases.set(lead.id, record)
    this.audit.push(`create:${lead.leadNumber}`)
    return lead
  }
  async updateLead(_o: string, i: { leadId: string; expectedUpdatedAt: Date; patch: PartialSyncRecord; nextBase: PartialSyncRecord }) {
    const lead = this.leads.get(i.leadId)!
    if (this.failNextUpdate) { this.failNextUpdate = false; return false }
    if (lead.updatedAt.getTime() !== i.expectedUpdatedAt.getTime()) return false
    lead.record = deriveContacted({ ...lead.record, ...i.patch } as SyncRecord)
    lead.updatedAt = this.now()
    this.bases.set(i.leadId, i.nextBase)
    this.audit.push(`update:${lead.leadNumber}`)
    return true
  }
  async setBase(_o: string, id: string, base: SyncRecord) { this.bases.set(id, base) }
  async saveConflicts(_o: string, leadId: string, c: FieldConflict[]) {
    for (const x of c) {
      const dup = this.conflicts.some(e => e.leadId === leadId && e.field === x.field && e.crmValue === x.crmValue && e.sheetValue === x.sheetValue)
      if (!dup) this.conflicts.push({ ...x, leadId })
    }
  }
  async saveRejected(_o: string, _b: string, rowRef: string, reason: string) { this.rejected.push({ rowRef, reason }) }
  async listChangedLeads(_o: string, q: { since: Date | null; afterId: string | null; limit: number }) {
    return [...this.leads.values()]
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id))
      .filter(l => !q.since || (q.afterId
        ? l.updatedAt > q.since || (l.updatedAt.getTime() === q.since.getTime() && l.id > q.afterId)
        : l.updatedAt >= q.since))
      .slice(0, q.limit)
  }
}

/** Mirrors the Postgres store: "contacted" is derived from the lifecycle stage. */
function deriveContacted(record: SyncRecord): SyncRecord {
  return { ...record, contacted: record.lifecycleStage === 'new' ? 'no' : 'yes' }
}
