import { beforeEach, describe, expect, it } from 'vitest'
import {
  ackPull,
  pullChanges,
  processPush,
  pushPayloadSchema,
  type PushPayload,
} from '@/lib/sync/lead-sync'
import { hashRecord, type SyncRecord } from '@/lib/sync/engine'
import { FakeStore } from './helpers/fake-sync-store'

const ORG = 'org_1'

let store: FakeStore
let n = 0
const batch = (rows: PushPayload['rows'], extra: Partial<PushPayload> = {}): PushPayload =>
  pushPayloadSchema.parse({ batchId: `batch-${++n}-xxxxxxxx`, rows, ...extra })
const newRow = (ref: string, fields: Record<string, unknown>) => ({ rowRef: `r-${ref}`, externalRef: `ext-${ref}-xxxxxxxx`, fields })

beforeEach(() => { store = new FakeStore(); n = 0 })

describe('creating leads from the sheet', () => {
  it('creates a lead, returns its CRM number, and keeps a base snapshot', async () => {
    const res = await processPush(store, ORG, batch([newRow('a', { firstName: 'Casey', lastName: 'Patel', email: 'Casey@Example.test' })]))
    expect(res.status).toBe('applied')
    expect(res.rows[0]).toMatchObject({ status: 'created', leadNumber: expect.stringMatching(/^LD-/) })
    const lead = [...store.leads.values()][0]
    expect(lead.record.email).toBe('casey@example.test')
    expect(lead.record.leadSource).toBe('other')
    expect(store.bases.get(lead.id)).toBeDefined()
  })

  it('re-sending the same batch never duplicates (replayed from the stored result)', async () => {
    const payload = batch([newRow('a', { firstName: 'Casey', email: 'c@example.test' })])
    await processPush(store, ORG, payload)
    const again = await processPush(store, ORG, payload)
    expect(again.replayed).toBe(true)
    expect(store.leads.size).toBe(1)
  })

  it('a retry under a NEW batchId still cannot duplicate (idempotent by externalRef)', async () => {
    const row = newRow('a', { firstName: 'Casey', email: 'c@example.test' })
    await processPush(store, ORG, batch([row]))
    const res = await processPush(store, ORG, batch([row]))
    expect(store.leads.size).toBe(1)
    expect(res.rows[0].status).toBe('unchanged')
    expect(res.rows[0].leadNumber).toBeDefined()
  })

  it('stores the raw payload before processing anything', async () => {
    const payload = batch([newRow('a', { firstName: 'Casey', email: 'c@example.test' })])
    await processPush(store, ORG, payload)
    expect(store.batches.get(payload.batchId)?.payload).toEqual(payload)
  })

  it('rejects, and records, rows that would be unsafe or invalid', async () => {
    const res = await processPush(store, ORG, batch([
      { rowRef: 'no-ref', fields: { firstName: 'X', email: 'x@example.test' } },
      newRow('b', { firstName: 'Y' }),
      newRow('c', { firstName: 'Z', email: 'not-an-email' }),
      newRow('d', { firstName: 'W', email: 'w@example.test', lifecycleStage: 'converted' }),
    ]))
    expect(res.rows.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected'])
    expect(store.rejected).toHaveLength(4)
    expect(store.leads.size).toBe(0)
  })

  it('rejects a duplicate instead of merging or duplicating', async () => {
    const existing = store.seed({ email: 'dup@example.test' })
    const res = await processPush(store, ORG, batch([newRow('a', { firstName: 'Q', email: 'DUP@example.test' })]))
    expect(res.rows[0].status).toBe('rejected')
    expect(res.rows[0].reason).toContain(existing.leadNumber)
    expect(store.leads.size).toBe(1)
  })

  it('one bad row does not block the good ones', async () => {
    const res = await processPush(store, ORG, batch([
      newRow('bad', { firstName: 'Bad' }),
      newRow('good', { firstName: 'Good', email: 'good@example.test' }),
    ]))
    expect(res.status).toBe('partial')
    expect(res.summary).toMatchObject({ created: 1, rejected: 1 })
    expect(store.leads.size).toBe(1)
  })
})

describe('updating leads from the sheet', () => {
  it('applies a sheet-only edit and leaves other CRM fields alone', async () => {
    const lead = store.seed({ city: 'Pune', jobTitle: 'Owner' })
    store.bases.set(lead.id, lead.record)
    const res = await processPush(store, ORG, batch([{ rowRef: 'r1', leadNumber: lead.leadNumber, fields: { city: 'Mumbai' } }]))
    expect(res.rows[0].status).toBe('updated')
    expect(store.leads.get(lead.id)!.record).toMatchObject({ city: 'Mumbai', jobTitle: 'Owner', email: lead.record.email })
    expect(store.audit).toContain(`update:${lead.leadNumber}`)
  })

  it('keeps BOTH edits when the CRM and the sheet change different fields', async () => {
    const lead = store.seed({ city: 'Pune', jobTitle: 'Owner' })
    store.bases.set(lead.id, lead.record)
    store.crmEdit(lead.leadNumber, { jobTitle: 'Director' })
    const res = await processPush(store, ORG, batch([
      { rowRef: 'r1', leadNumber: lead.leadNumber, fields: { city: 'Mumbai', jobTitle: 'Owner' } },
    ]))
    expect(store.leads.get(lead.id)!.record).toMatchObject({ city: 'Mumbai', jobTitle: 'Director' })
    expect(res.rows[0].record).toMatchObject({ city: 'Mumbai', jobTitle: 'Director' })
  })

  it('on a same-field conflict the CRM wins and the sheet value is preserved in the conflict log', async () => {
    const lead = store.seed({ city: 'Pune' })
    store.bases.set(lead.id, lead.record)
    store.crmEdit(lead.leadNumber, { city: 'Delhi' })
    const res = await processPush(store, ORG, batch([{ rowRef: 'r1', leadNumber: lead.leadNumber, fields: { city: 'Mumbai' } }]))
    expect(store.leads.get(lead.id)!.record.city).toBe('Delhi')
    expect(store.conflicts).toEqual([expect.objectContaining({ field: 'city', crmValue: 'Delhi', sheetValue: 'Mumbai' })])
    expect(res.rows[0].record?.city).toBe('Delhi') // sheet is told to take the CRM value
    expect(res.rows[0].conflicts).toHaveLength(1)
  })

  it('does not pile up duplicate conflict rows when the same batch content is retried', async () => {
    const lead = store.seed({ city: 'Pune' })
    store.bases.set(lead.id, lead.record)
    store.crmEdit(lead.leadNumber, { city: 'Delhi' })
    const row = { rowRef: 'r1', leadNumber: lead.leadNumber, fields: { city: 'Mumbai' } }
    await processPush(store, ORG, batch([row]))
    await processPush(store, ORG, batch([row]))
    expect(store.conflicts).toHaveLength(1)
  })

  it('writes nothing and asks for a retry when the CRM changes mid-sync', async () => {
    const lead = store.seed({ city: 'Pune' })
    store.bases.set(lead.id, lead.record)
    store.failNextUpdate = true
    const res = await processPush(store, ORG, batch([{ rowRef: 'r1', leadNumber: lead.leadNumber, fields: { city: 'Mumbai' } }]))
    expect(res.rows[0].status).toBe('retry')
    expect(store.leads.get(lead.id)!.record.city).toBe('Pune')
    expect(res.status).toBe('partial')
  })

  it('rejects unknown, archived, required-blanking and conversion edits', async () => {
    const live = store.seed({})
    store.bases.set(live.id, live.record)
    const archived = store.seed({}, { deletedAt: new Date() })
    const res = await processPush(store, ORG, batch([
      { rowRef: 'unknown', leadNumber: 'LD-999999', fields: { city: 'X' } },
      { rowRef: 'archived', leadNumber: archived.leadNumber, fields: { city: 'X' } },
      { rowRef: 'blank', leadNumber: live.leadNumber, fields: { firstName: '' } },
      { rowRef: 'convert', leadNumber: live.leadNumber, fields: { lifecycleStage: 'converted' } },
      { rowRef: 'badstage', leadNumber: live.leadNumber, fields: { lifecycleStage: 'banana' } },
    ]))
    expect(res.rows.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected'])
    expect(store.leads.get(live.id)!.record.firstName).toBe('Sam')
    expect(store.leads.get(archived.id)!.deletedAt).not.toBeNull()
  })

  it('rejects changing an email to one that belongs to another lead', async () => {
    const a = store.seed({ email: 'a@example.test' }); store.bases.set(a.id, a.record)
    const b = store.seed({ email: 'b@example.test' })
    const res = await processPush(store, ORG, batch([{ rowRef: 'r', leadNumber: a.leadNumber, fields: { email: 'b@example.test' } }]))
    expect(res.rows[0].status).toBe('rejected')
    expect(res.rows[0].reason).toContain(b.leadNumber)
  })

  it('an empty / shifted-column row set cannot wipe data (mass-blank halt)', async () => {
    const leads = Array.from({ length: 8 }, (_, i) => store.seed({ city: `City${i}` }))
    leads.forEach(l => store.bases.set(l.id, l.record))
    const rows = leads.map((l, i) => ({ rowRef: `r${i}`, leadNumber: l.leadNumber, fields: { city: '' } }))

    const halted = await processPush(store, ORG, batch(rows))
    expect(halted.status).toBe('halted')
    expect(halted.haltReason).toBeDefined()
    expect(leads.every(l => store.leads.get(l.id)!.record.city !== null)).toBe(true)
    expect(store.rejected.length).toBe(8) // every row recorded for review

    const confirmed = await processPush(store, ORG, batch(rows, { confirmMassChange: true }))
    expect(confirmed.summary.updated).toBe(8)
  })
})

describe('CRM -> sheet pull and ack', () => {
  it('delivers changes in pages without skipping or repeating', async () => {
    for (let i = 0; i < 5; i++) store.seed({})
    const p1 = await pullChanges(store, ORG, { limit: 2 })
    const p2 = await pullChanges(store, ORG, { limit: 2, cursor: p1.nextCursor })
    const p3 = await pullChanges(store, ORG, { limit: 2, cursor: p2.nextCursor })
    const all = [...p1.items, ...p2.items, ...p3.items].map(i => i.leadNumber)
    expect(all).toHaveLength(5)
    expect(new Set(all).size).toBe(5)
    expect([p1.hasMore, p2.hasMore, p3.hasMore]).toEqual([true, true, false])
  })

  it('includes archived leads flagged as archived (never silently disappears)', async () => {
    store.seed({}, { deletedAt: new Date() })
    const res = await pullChanges(store, ORG, {})
    expect(res.items[0].archived).toBe(true)
  })

  it('a fresh run re-delivers recent changes (late-commit safety)', async () => {
    store.seed({})
    const first = await pullChanges(store, ORG, {})
    const next = await pullChanges(store, ORG, { cursor: first.nextCursor, fresh: true })
    expect(next.items).toHaveLength(1)
  })

  it('advances the base only for records unchanged since delivery', async () => {
    const lead = store.seed({ city: 'Pune' })
    const pulled = (await pullChanges(store, ORG, {})).items[0]
    store.crmEdit(lead.leadNumber, { city: 'Delhi' }) // changes after delivery
    const res = await ackPull(store, ORG, [
      { leadNumber: lead.leadNumber, hash: pulled.hash },
      { leadNumber: 'LD-404404', hash: 'a'.repeat(64) },
    ])
    expect(res).toEqual({ confirmed: [], stale: [lead.leadNumber], unknown: ['LD-404404'] })
    expect(store.bases.get(lead.id)).toBeUndefined()

    const fresh = (await pullChanges(store, ORG, {})).items[0]
    const ok = await ackPull(store, ORG, [{ leadNumber: lead.leadNumber, hash: fresh.hash }])
    expect(ok.confirmed).toEqual([lead.leadNumber])
    expect(hashRecord(store.bases.get(lead.id) as SyncRecord)).toBe(fresh.hash)
  })

  it('full round trip: pull, ack, then sheet and CRM edit different fields — both survive', async () => {
    const lead = store.seed({ city: 'Pune', jobTitle: 'Owner' })
    const pulled = (await pullChanges(store, ORG, {})).items[0]
    await ackPull(store, ORG, [{ leadNumber: lead.leadNumber, hash: pulled.hash }])

    store.crmEdit(lead.leadNumber, { jobTitle: 'Director' })
    await processPush(store, ORG, batch([
      { rowRef: 'r1', leadNumber: lead.leadNumber, fields: { ...pulled.record, city: 'Mumbai' } },
    ]))
    expect(store.leads.get(lead.id)!.record).toMatchObject({ city: 'Mumbai', jobTitle: 'Director' })
    expect(store.conflicts).toHaveLength(0)
  })
})

describe('payload limits', () => {
  it('rejects empty and oversized batches', () => {
    expect(pushPayloadSchema.safeParse({ batchId: 'batch-12345678', rows: [] }).success).toBe(false)
    const rows = Array.from({ length: 501 }, (_, i) => ({ rowRef: `r${i}`, fields: { city: 'x' } }))
    expect(pushPayloadSchema.safeParse({ batchId: 'batch-12345678', rows }).success).toBe(false)
  })
})

describe('lead numbers unknown to this CRM', () => {
  it('re-creates the row as a new lead when it carries an externalRef', async () => {
    const store = new FakeStore()
    const payload = pushPayloadSchema.parse({
      batchId: 'unknown-number-batch-1',
      rows: [{ rowRef: 'r1', leadNumber: 'LD-000042', externalRef: 'ext-unknown-0001', fields: { firstName: 'Casey', email: 'casey@example.test' } }],
    })
    const res = await processPush(store, 'org_1', payload)
    expect(res.rows[0].status).toBe('created')
    expect(res.rows[0].leadNumber).not.toBe('LD-000042')
  })

  it('still rejects an unknown lead number that has no externalRef', async () => {
    const store = new FakeStore()
    const payload = pushPayloadSchema.parse({
      batchId: 'unknown-number-batch-2',
      rows: [{ rowRef: 'r1', leadNumber: 'LD-000042', fields: { city: 'Mumbai' } }],
    })
    const res = await processPush(store, 'org_1', payload)
    expect(res.rows[0].status).toBe('rejected')
  })
})
