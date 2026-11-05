import { describe, expect, it } from 'vitest'
import {
  assessBatchRisk,
  canonicalizeFull,
  canonicalizePartial,
  hashRecord,
  requiredBlanks,
  threeWayMerge,
  type SyncRecord,
} from '@/lib/sync/engine'
import { signPayload, verifySignature } from '@/lib/sync/signature'

const baseRecord = (over: Partial<SyncRecord> = {}): SyncRecord =>
  canonicalizeFull({
    firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.test', phone: '+919876543210',
    leadSource: 'website', lifecycleStage: 'new', city: 'Pune', jobTitle: 'Owner', ...over,
  })

describe('canonicalisation', () => {
  it('normalises values so equal data always compares equal', () => {
    const rec = canonicalizePartial({
      email: '  Jordan@Example.TEST ', phone: '+91 98765-43210', lifecycleStage: 'Demo Booked',
      leadSource: 'Inbound-Call', city: '   ',
    })
    expect(rec).toEqual({
      email: 'jordan@example.test', phone: '+919876543210', lifecycleStage: 'demo_booked',
      leadSource: 'inbound_call', city: null,
    })
  })

  it('treats a missing column as untouched, not as blank', () => {
    expect(Object.keys(canonicalizePartial({ city: 'Pune' }))).toEqual(['city'])
  })

  it('keeps an unparseable date verbatim so validation can reject it', () => {
    expect(canonicalizePartial({ nextFollowUpAt: 'next tuesday-ish' }).nextFollowUpAt).toBe('next tuesday-ish')
  })

  it('hashes identically regardless of key order', () => {
    const a = baseRecord()
    const b = Object.fromEntries(Object.entries(a).reverse()) as SyncRecord
    expect(hashRecord(a)).toBe(hashRecord(b))
    expect(hashRecord(a)).not.toBe(hashRecord(baseRecord({ city: 'Delhi' })))
  })
})

describe('three-way merge', () => {
  it('keeps edits to different fields on each side (nothing lost)', () => {
    const base = baseRecord()
    const crm = baseRecord({ jobTitle: 'Director' }) // CRM edited jobTitle
    const sheet = canonicalizePartial({ ...base, city: 'Mumbai' }) // sheet edited city, still has old jobTitle
    const r = threeWayMerge(base, crm, sheet)
    expect(r.merged.city).toBe('Mumbai')
    expect(r.merged.jobTitle).toBe('Director')
    expect(r.crmPatch).toEqual({ city: 'Mumbai' })
    expect(r.sheetCorrections).toEqual({ jobTitle: 'Director' })
    expect(r.conflicts).toHaveLength(0)
  })

  it('records a conflict, keeps the loser, and CRM wins by default', () => {
    const base = baseRecord()
    const crm = baseRecord({ city: 'Delhi' })
    const sheet = canonicalizePartial({ city: 'Mumbai' })
    const r = threeWayMerge(base, crm, sheet)
    expect(r.conflicts).toEqual([
      { field: 'city', crmValue: 'Delhi', sheetValue: 'Mumbai', winner: 'crm', resolvedValue: 'Delhi' },
    ])
    expect(r.crmPatch).toEqual({})
    expect(r.sheetCorrections.city).toBe('Delhi')
  })

  it('can be configured so the sheet wins, still recording the CRM value', () => {
    const r = threeWayMerge(baseRecord(), baseRecord({ city: 'Delhi' }), canonicalizePartial({ city: 'Mumbai' }), 'sheet')
    expect(r.crmPatch).toEqual({ city: 'Mumbai' })
    expect(r.conflicts[0]).toMatchObject({ crmValue: 'Delhi', sheetValue: 'Mumbai', winner: 'sheet' })
  })

  it('does not advance the base on a CRM-wins conflict, so a retry cannot flip the winner', () => {
    const base = baseRecord()
    const crm = baseRecord({ city: 'Delhi' })
    const sheet = canonicalizePartial({ city: 'Mumbai' })
    const first = threeWayMerge(base, crm, sheet)
    // Sheet script failed to apply the correction and re-sends the same value:
    const retry = threeWayMerge(first.nextBase, crm, sheet)
    expect(retry.crmPatch).toEqual({})
    expect(retry.conflicts).toHaveLength(1)
  })

  it('never silently overrides: a never-synced record with differing values is a conflict', () => {
    const r = threeWayMerge(null, baseRecord({ city: 'Delhi' }), canonicalizePartial({ city: 'Mumbai' }))
    expect(r.conflicts).toHaveLength(1)
    expect(r.crmPatch).toEqual({})
  })

  it('only touches columns the sheet sent', () => {
    const r = threeWayMerge(baseRecord(), baseRecord(), canonicalizePartial({ city: 'Pune' }))
    expect(Object.keys(r.merged)).toEqual(['city'])
    expect(r.crmPatch).toEqual({})
  })

  it('flags fields a sheet edit would clear', () => {
    const base = baseRecord()
    const r = threeWayMerge(base, base, canonicalizePartial({ city: '' }))
    expect(r.crmPatch).toEqual({ city: null })
    expect(r.blankedFields).toEqual(['city'])
  })

  it('refuses to blank required fields', () => {
    expect(requiredBlanks({ firstName: null, city: null })).toEqual(['firstName'])
    expect(requiredBlanks({ city: null })).toEqual([])
  })
})

describe('mass-blank circuit breaker', () => {
  const blanking = Array.from({ length: 6 }, () => ({ blankedFields: ['city' as const] }))
  const clean = Array.from({ length: 4 }, () => ({ blankedFields: [] }))

  it('halts when too many rows would clear data', () => {
    const risk = assessBatchRisk([...blanking, ...clean])
    expect(risk.halted).toBe(true)
    expect(risk.reason).toContain('Nothing was applied')
  })

  it('allows a normal batch and small batches', () => {
    expect(assessBatchRisk([blanking[0], ...Array.from({ length: 9 }, () => ({ blankedFields: [] }))]).halted).toBe(false)
    expect(assessBatchRisk(blanking.slice(0, 3)).halted).toBe(false)
  })

  it('can be overridden only by an explicit confirmation', () => {
    expect(assessBatchRisk(blanking, { confirmed: true }).halted).toBe(false)
  })
})

describe('request signatures', () => {
  const secret = 'a'.repeat(40)
  const now = 1_700_000_000_000
  const ts = String(now)
  const body = '{"batchId":"b-12345678"}'
  const good = signPayload(secret, ts, body)

  it('accepts a valid signature', () => {
    expect(verifySignature({ secret, timestamp: ts, signature: good, payload: body, now }).ok).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifySignature({ secret, timestamp: ts, signature: good, payload: body + ' ', now }).ok).toBe(false)
  })
  it('rejects a replayed (old) request', () => {
    expect(verifySignature({ secret, timestamp: ts, signature: good, payload: body, now: now + 10 * 60_000 }).ok).toBe(false)
  })
  it('rejects the wrong secret and malformed signatures', () => {
    expect(verifySignature({ secret: 'b'.repeat(40), timestamp: ts, signature: good, payload: body, now }).ok).toBe(false)
    expect(verifySignature({ secret, timestamp: ts, signature: 'zz', payload: body, now }).ok).toBe(false)
  })
  it('fails closed when no (or a weak) secret is configured', () => {
    expect(verifySignature({ secret: undefined, timestamp: ts, signature: good, payload: body, now }).ok).toBe(false)
    expect(verifySignature({ secret: 'short', timestamp: ts, signature: signPayload('short', ts, body), payload: body, now }).ok).toBe(false)
  })
})
