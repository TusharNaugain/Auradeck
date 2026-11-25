import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/services/numbering', () => ({ nextCounterValueInTx: vi.fn(async () => 1) }))

import { accountLifecycleFor, applyStageFlow, opportunityStageFor } from '@/lib/leads/stage-flow'

type Row = Record<string, unknown> & { id: string }

/** Tiny in-memory stand-in for the Prisma transaction client (only what the flow uses). */
function fakeTx() {
  let seq = 0
  const id = (p: string) => `${p}${++seq}`
  const leads = new Map<string, Row>()
  const opps = new Map<string, Row>()
  const accounts = new Map<string, Row>()
  const contacts = new Map<string, Row>()
  const projects: Row[] = []
  const history: Row[] = []
  const tx = {
    lead: {
      findFirst: async ({ where }: { where: { id: string } }) => leads.get(where.id) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => leads.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(leads.get(where.id)!, data),
    },
    opportunity: {
      create: async ({ data }: { data: Row }) => { const r = { ...data, id: id('opp') }; opps.set(r.id, r); return r },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(opps.get(where.id)!, data),
      findUnique: async ({ where }: { where: { id: string } }) => opps.get(where.id) ?? null,
    },
    opportunityStageHistory: { create: async ({ data }: { data: Row }) => { history.push(data); return data } },
    account: {
      create: async ({ data }: { data: Row }) => { const r = { ...data, id: id('acc') }; accounts.set(r.id, r); return r },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(accounts.get(where.id)!, data),
      findUnique: async ({ where }: { where: { id: string } }) => accounts.get(where.id) ?? null,
    },
    contact: { create: async ({ data }: { data: Row }) => { const r = { ...data, id: id('con') }; contacts.set(r.id, r); return r } },
    onboardingProject: {
      findFirst: async ({ where }: { where: { accountId: string } }) => [...projects].reverse().find((p) => p.accountId === where.accountId) ?? null,
      create: async ({ data }: { data: Row }) => { const r = { ...data, id: id('onb') }; projects.push(r); return r },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(projects.find((p) => p.id === where.id)!, data),
    },
  }
  return { tx: tx as never, leads, opps, accounts, contacts, projects, history }
}

const baseLead = (over: Partial<Row> = {}): Row => ({
  id: 'L1', organisationId: 'org', leadNumber: 'LD-1', firstName: 'Asha', lastName: 'Rao', fullName: 'Asha Rao',
  organisationName: 'Calm Minds', email: 'asha@calm.in', phoneNumber: null, phoneCountryCode: null, whatsappNumber: null,
  jobTitle: 'Psychologist', consentStatus: null, tags: [], leadSource: 'WEBSITE', assignedToUserId: 'u1',
  lifecycleStage: 'NEW', opportunityId: null, convertedAccountId: null, convertedContactId: null, ...over,
})

let t: ReturnType<typeof fakeTx>
const move = async (to: string) => {
  const lead = t.leads.get('L1')!
  const from = lead.lifecycleStage as string
  lead.lifecycleStage = to
  return applyStageFlow(t.tx, { organisationId: 'org', leadId: 'L1', from, actorUserId: 'u1' })
}

beforeEach(() => {
  t = fakeTx()
  t.leads.set('L1', baseLead())
})

describe('stage flow', () => {
  it('does nothing to other sections for early stages', async () => {
    expect(await move('CONTACTED')).toEqual([])
    expect(await move('INTERESTED')).toEqual([])
    expect(t.opps.size + t.accounts.size + t.projects.length).toBe(0)
  })

  it('creates a deal at Demo scheduled and moves it at Demo attended', async () => {
    expect(await move('DEMO_SCHEDULED')).toEqual(['Deal created in Opportunities'])
    const opp = [...t.opps.values()][0]
    expect(opp).toMatchObject({ stage: 'DEMO', name: 'Calm Minds — AuraDeck', ownerUserId: 'u1' })
    expect(t.leads.get('L1')!.opportunityId).toBe(opp.id)
    await move('DEMO_ATTENDED')
    expect(opp.stage).toBe('SOLUTION_FIT')
    expect(t.history.map((h) => h.toStage)).toEqual(['DEMO', 'SOLUTION_FIT'])
  })

  it('at Signed up creates the account, contact and onboarding, linking the deal', async () => {
    await move('DEMO_SCHEDULED')
    const notes = await move('SIGNED_UP')
    expect(notes).toEqual(expect.arrayContaining(['Customer added to Accounts and Contacts', 'Onboarding started']))
    const account = [...t.accounts.values()][0]
    const contact = [...t.contacts.values()][0]
    expect(account).toMatchObject({ accountName: 'Calm Minds', lifecycleStage: 'trial' })
    expect(contact).toMatchObject({ accountId: account.id, email: 'asha@calm.in', isPrimary: true })
    expect([...t.opps.values()][0]).toMatchObject({ accountId: account.id, primaryContactId: contact.id, stage: 'VERBAL_COMMIT' })
    expect(t.projects[0]).toMatchObject({ accountId: account.id, status: 'SCHEDULED', projectName: 'Calm Minds onboarding' })
  })

  it('jumping straight to Paid creates everything once and marks the deal won', async () => {
    await move('PAID')
    expect(t.opps.size).toBe(1)
    expect(t.accounts.size).toBe(1)
    expect([...t.opps.values()][0]).toMatchObject({ stage: 'WON', forecastCategory: 'CLOSED' })
    expect([...t.accounts.values()][0].lifecycleStage).toBe('paid')
    expect(t.projects[0].status).toBe('COMPLETED')
    await move('ACTIVATED') // moving around never duplicates records
    expect(t.opps.size + t.accounts.size + t.projects.length).toBe(3)
  })

  it('Activated completes onboarding; Churned marks the account and cancels unfinished onboarding', async () => {
    await move('SIGNED_UP')
    expect(await move('ACTIVATED')).toContain('Onboarding marked complete')
    expect(t.projects[0]).toMatchObject({ status: 'COMPLETED', progressPercentage: 100 })

    t = fakeTx(); t.leads.set('L1', baseLead())
    await move('SIGNED_UP')
    const notes = await move('CHURNED')
    expect(notes).toEqual(expect.arrayContaining(['Unfinished onboarding cancelled', 'Account marked churned']))
    expect([...t.accounts.values()][0].lifecycleStage).toBe('churned')
  })

  it('Dead closes an open deal as lost and creates nothing new', async () => {
    expect(await move('LOST')).toEqual([])
    expect(t.opps.size).toBe(0)
    t.leads.get('L1')!.lifecycleStage = 'CONTACTED'
    await move('DEMO_SCHEDULED')
    expect(await move('LOST')).toEqual(['Deal marked Lost'])
    expect([...t.opps.values()][0]).toMatchObject({ stage: 'LOST' })
    expect(t.accounts.size).toBe(0)
  })

  it('maps stages for deals and accounts', () => {
    expect(opportunityStageFor('INTERESTED')).toBeNull()
    expect(opportunityStageFor('CHURNED')).toBeNull()
    expect(accountLifecycleFor('ACTIVATED')).toBe('active')
    expect(accountLifecycleFor('DEMO_ATTENDED')).toBeNull()
  })
})
