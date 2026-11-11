/**
 * The "Auradeck early access" sheet: Timestamp, Email, Source, Contacted,
 * Invite code, Invited at, Trial Started, LinkedIn, Whats App. Email-only
 * signups, free-text sources, YES/No/FALSE flags and "na" placeholders.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { processPush, pushPayloadSchema, type PushPayload } from '@/lib/sync/lead-sync'
import { canonicalValue, canonicalizePartial, deriveLeadSource, isPrioritySource, placeholderNameFromEmail } from '@/lib/sync/engine'
import { FakeStore } from './helpers/fake-sync-store'

const ORG = 'org_1'
let store: FakeStore
let n = 0
const batch = (rows: PushPayload['rows']): PushPayload => pushPayloadSchema.parse({ batchId: `wl-batch-${++n}-xxxxxxxx`, rows })
const signup = (ref: string, fields: Record<string, unknown>) => ({ rowRef: `row-${ref}`, externalRef: `ext-${ref}-xxxxxxxx`, fields })

beforeEach(() => { store = new FakeStore(); n = 0 })

describe('waitlist value rules', () => {
  it('maps free-text sources to CRM lead sources (including the "refferal" typo)', () => {
    expect(deriveLeadSource('hero')).toBe('website')
    expect(deriveLeadSource('survey')).toBe('campaign')
    expect(deriveLeadSource('refferal ')).toBe('referral')
    expect(deriveLeadSource('Referral')).toBe('referral')
    expect(deriveLeadSource('something new')).toBe('other')
    expect(deriveLeadSource(null)).toBe('other')
  })

  it('uses the email prefix as a temporary name', () => {
    expect(placeholderNameFromEmail('kanupriyamody@gmail.com')).toBe('kanupriyamody')
    expect(placeholderNameFromEmail('a'.repeat(80) + '@x.test')).toHaveLength(50)
    expect(placeholderNameFromEmail(null)).toBeNull()
  })

  it('treats YES / yes / TRUE as yes and No / FALSE / blank as no', () => {
    for (const v of ['YES ', 'yes', 'TRUE', true, 'y']) expect(canonicalValue('contacted', v)).toBe('yes')
    for (const v of ['No', 'FALSE', false, '', null, undefined, ' ']) expect(canonicalValue('contacted', v)).toBe('no')
    expect(canonicalValue('whatsappOptIn', 'yes')).toBe('yes')
  })

  it('treats "na" as nothing for LinkedIn but keeps real URLs untouched', () => {
    expect(canonicalValue('linkedin', 'na')).toBeNull()
    expect(canonicalValue('linkedin', ' N/A ')).toBeNull()
    expect(canonicalValue('linkedin', 'https://www.linkedin.com/in/sneha-chovatiya/')).toBe('https://www.linkedin.com/in/sneha-chovatiya/')
  })

  it('normalises date cells to ISO and leaves unparseable text visible', () => {
    expect(canonicalizePartial({ invitedAt: '2026-10-12T00:00:00.000Z' }).invitedAt).toBe('2026-10-12T00:00:00.000Z')
    expect(canonicalizePartial({ signedUpAt: 'not a date' }).signedUpAt).toBe('not a date')
  })
})

describe('creating leads from signup rows', () => {
  it('turns an email-only row into a lead, keeping every sheet value', async () => {
    const res = await processPush(store, ORG, batch([signup('a', {
      signedUpAt: '2026-10-09T12:23:47.000Z', email: 'Kanupriyamody@Gmail.com', waitlistSource: 'hero', contacted: 'YES',
      inviteCode: 'AURA-FDL3AU', invitedAt: '2026-10-12T00:00:00.000Z', trialStartedAt: '', linkedin: 'na', whatsappOptIn: '',
    })]))
    expect(res.rows[0].status).toBe('created')
    const rec = [...store.leads.values()][0].record
    expect(rec).toMatchObject({
      firstName: 'Kanupriyamody'.toLowerCase(), email: 'kanupriyamody@gmail.com',
      leadSource: 'website', waitlistSource: 'hero', lifecycleStage: 'contacted', contacted: 'yes',
      inviteCode: 'AURA-FDL3AU', invitedAt: '2026-10-12T00:00:00.000Z', signedUpAt: '2026-10-09T12:23:47.000Z',
      linkedin: null, whatsappOptIn: 'no', trialStartedAt: null,
    })
  })

  it('starts leads at "new" when Contacted is No, FALSE or blank', async () => {
    await processPush(store, ORG, batch([
      signup('a', { email: 'a@example.test', contacted: 'No' }),
      signup('b', { email: 'b@example.test', contacted: false }),
      signup('c', { email: 'c@example.test', contacted: '' }),
    ]))
    expect([...store.leads.values()].map(l => l.record.lifecycleStage)).toEqual(['new', 'new', 'new'])
  })

  it('keeps the original source text while categorising the lead', async () => {
    await processPush(store, ORG, batch([
      signup('a', { email: 'a@example.test', waitlistSource: 'refferal ' }),
      signup('b', { email: 'b@example.test', waitlistSource: 'survey' }),
    ]))
    const recs = [...store.leads.values()].map(l => l.record)
    expect(recs.map(r => r.leadSource)).toEqual(['referral', 'campaign'])
    expect(recs.map(r => r.waitlistSource)).toEqual(['refferal', 'survey'])
  })

  it('rejects the row where a name was typed into the Email column, and records why', async () => {
    const res = await processPush(store, ORG, batch([
      signup('bad', { email: 'Nayana singh', waitlistSource: 'refferal' }),
      signup('ok', { email: 'ok@example.test' }),
    ]))
    expect(res.rows[0].status).toBe('rejected')
    expect(res.rows[0].reason).toMatch(/email/i)
    expect(res.rows[1].status).toBe('created')
    expect(store.rejected).toHaveLength(1)
  })

  it('stores the WhatsApp column as a flag, never as a phone number', async () => {
    await processPush(store, ORG, batch([signup('a', { email: 'a@example.test', whatsappOptIn: 'yes' })]))
    const rec = [...store.leads.values()][0].record
    expect(rec.whatsappOptIn).toBe('yes')
    expect(rec.whatsappNumber).toBeNull()
  })

  it('rejects an unparseable date instead of dropping or guessing it', async () => {
    const res = await processPush(store, ORG, batch([signup('a', { email: 'a@example.test', invitedAt: 'sometime in oct' })]))
    expect(res.rows[0].status).toBe('rejected')
    expect(res.rows[0].reason).toContain('invitedAt')
  })
})

describe('"Contacted" only ever moves a lead forward', () => {
  const synced = (stage: 'new' | 'contacted' | 'qualified') => {
    const lead = store.seed({ lifecycleStage: stage })
    store.bases.set(lead.id, lead.record)
    return lead
  }
  const push = (leadNumber: string, fields: Record<string, unknown>) =>
    processPush(store, ORG, batch([{ rowRef: 'r', leadNumber, fields }]))

  it('YES promotes a New lead to Contacted', async () => {
    const lead = synced('new')
    const res = await push(lead.leadNumber, { contacted: 'YES' })
    expect(res.rows[0].status).toBe('updated')
    expect(store.leads.get(lead.id)!.record).toMatchObject({ lifecycleStage: 'contacted', contacted: 'yes' })
  })

  it('NO never demotes a contacted lead, and the sheet is told it is contacted', async () => {
    const lead = synced('contacted')
    const res = await push(lead.leadNumber, { contacted: 'No' })
    expect(store.leads.get(lead.id)!.record.lifecycleStage).toBe('contacted')
    expect(res.rows[0].status).toBe('unchanged')
    expect(res.rows[0].record?.contacted).toBe('yes')
    expect(store.conflicts).toHaveLength(0)
  })

  it('a lead the CRM moved to Qualified stays Qualified even if the sheet still says No', async () => {
    const lead = synced('new')
    store.crmEdit(lead.leadNumber, { lifecycleStage: 'qualified' })
    const res = await push(lead.leadNumber, { contacted: 'No' })
    expect(store.leads.get(lead.id)!.record.lifecycleStage).toBe('qualified')
    expect(res.rows[0].record?.contacted).toBe('yes')
  })
})

describe('editing the extra columns', () => {
  it('syncs an invite code edit without touching other fields', async () => {
    const lead = store.seed({ inviteCode: null, linkedin: 'https://linkedin.com/in/x', city: 'Pune' })
    store.bases.set(lead.id, lead.record)
    const res = await processPush(store, ORG, batch([{ rowRef: 'r', leadNumber: lead.leadNumber, fields: { inviteCode: 'AURA-NEW123' } }]))
    expect(res.rows[0].status).toBe('updated')
    expect(store.leads.get(lead.id)!.record).toMatchObject({
      inviteCode: 'AURA-NEW123', linkedin: 'https://linkedin.com/in/x', city: 'Pune',
    })
  })

  it('records a conflict (CRM wins) when both sides change the same invite code', async () => {
    const lead = store.seed({ inviteCode: 'AURA-OLD111' })
    store.bases.set(lead.id, lead.record)
    store.crmEdit(lead.leadNumber, { inviteCode: 'AURA-CRM222' })
    await processPush(store, ORG, batch([{ rowRef: 'r', leadNumber: lead.leadNumber, fields: { inviteCode: 'AURA-SHEET3' } }]))
    expect(store.leads.get(lead.id)!.record.inviteCode).toBe('AURA-CRM222')
    expect(store.conflicts).toEqual([expect.objectContaining({ field: 'inviteCode', crmValue: 'AURA-CRM222', sheetValue: 'AURA-SHEET3' })])
  })
})

describe("isPrioritySource", () => {
  it("treats sources starting with Hot as priority reachout", () => {
    expect(isPrioritySource("Hot lead - Survey ")).toBe(true)
    expect(isPrioritySource("hot lead")).toBe(true)
    expect(isPrioritySource("  HOT")).toBe(true)
  })
  it("leaves everything else as Others", () => {
    expect(isPrioritySource("Maybe - Survey")).toBe(false)
    expect(isPrioritySource("hotel enquiry")).toBe(false)
    expect(isPrioritySource("survey")).toBe(false)
    expect(isPrioritySource(null)).toBe(false)
    expect(isPrioritySource(undefined)).toBe(false)
  })
})
