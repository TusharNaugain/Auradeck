import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDemoResponse } from '@/lib/client/demo-data'

describe('browser-only demo mode', () => {
  let apiRequest: typeof import('@/lib/client/api').apiRequest
  let ApiError: typeof import('@/lib/client/api').ApiError

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', 'true')
    vi.resetModules()
    const client = await import('@/lib/client/api')
    apiRequest = client.apiRequest
    ApiError = client.ApiError
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('serves sample CRM rows locally with no API request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    await expect(apiRequest('/api/leads')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'demo-lead-1', fullName: 'Jordan Lee' }),
      ]),
      total: 10,
    })
    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })

  it('returns dashboard-shaped sample data', () => {
    expect(getDemoResponse<{ dashboard: { sales: { pipelineValue: number } } }>(
      '/api/reports/overview'
    ).dashboard.sales.pipelineValue).toBeGreaterThan(0)
  })

  it('applies list search and filter parameters to sample rows', () => {
    expect(getDemoResponse<{ items: { fullName: string }[] }>('/api/leads', {
      search: 'Jordan',
    }).items.map(row => row.fullName)).toEqual(['Jordan Lee'])
    expect(getDemoResponse<{ items: { fullName: string }[] }>('/api/leads', {
      stage: 'contacted',
    }).items.map(row => row.fullName)).toEqual(['Sam Taylor', 'Aisha Noor', 'Arjun Kapoor'])
  })

  it('shows imported sheet leads instead of sample leads while preserving unrelated saved leads', () => {
    const storage = new Map<string, string>([
      ['auradeck-demo-sheet-leads-v1', JSON.stringify([{
        id: 'sheet-lead-one',
        fullName: 'person@example.com',
        email: 'person@example.com',
        leadSource: 'OTHER',
        lifecycleStage: 'NEW',
        customFields: { sheet_source: 'hero', sheet_contacted: 'YES' },
      }])],
      ['auradeck-demo-leads-v1', JSON.stringify([{
        id: 'demo-lead-1',
        fullName: 'Jordan Lee',
        email: 'jordan@example.test',
      }, {
        id: 'locally-created-lead',
        fullName: 'Saved Lead',
        email: 'saved@example.com',
      }])],
    ])
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })

    try {
      const leads = getDemoResponse<{ items: { id: string; fullName: string }[]; total: number }>('/api/leads')
      expect(leads.total).toBe(2)
      expect(leads.items.map((lead) => lead.id)).toEqual(['sheet-lead-one', 'locally-created-lead'])
      expect(leads.items.map((lead) => lead.fullName)).toEqual(['person@example.com', 'Saved Lead'])
      expect(getDemoResponse<{
        lead: { fullName: string; customFields: Record<string, string> }
        activities: unknown[]
      }>('/api/leads/sheet-lead-one')).toMatchObject({
        lead: {
          fullName: 'person@example.com',
          customFields: { sheet_source: 'hero', sheet_contacted: 'YES' },
        },
        activities: [],
      })
      expect(getDemoResponse<{ total: number }>('/api/accounts').total).toBe(0)
      expect(getDemoResponse<{ items: unknown[] }>('/api/billing').items).toEqual([])
      expect(getDemoResponse<{ results: unknown[] }>('/api/search', { q: 'Jordan' }).results).toEqual([])
      expect(getDemoResponse<{
        dashboard: {
          sales: { totalLeads: number; salesThisMonth: number; pipelineValue: number }
          billing: { paidSubscriptions: number }
        }
      }>('/api/reports/overview').dashboard).toMatchObject({
        sales: { totalLeads: 2, salesThisMonth: 0, pipelineValue: 0 },
        billing: { paidSubscriptions: 0 },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('serves sample lead details with activity, payment, and onboarding context', () => {
    const convertedLead = getDemoResponse<{
      lead: { convertedAccount: { subscriptions: { status: string }[] } }
      activities: { subject: string }[]
    }>('/api/leads/demo-lead-4')
    expect(convertedLead).toMatchObject({
      lead: {
        convertedAccount: {
          subscriptions: [{ status: 'ACTIVE' }],
        },
      },
      activities: [],
    })
    expect(getDemoResponse<{ activities: { subject: string }[] }>('/api/leads/demo-lead-2').activities)
      .toEqual([expect.objectContaining({ subject: 'Discovery call with Willow Wellness' })])
  })

  it('returns stage counts for the full filtered lead set', () => {
    expect(getDemoResponse<{ stageCounts: { stage: string; count: number }[] }>('/api/leads').stageCounts)
      .toEqual(expect.arrayContaining([
        { stage: 'QUALIFIED', count: 2 },
        { stage: 'CONTACTED', count: 3 },
        { stage: 'CONVERTED', count: 1 },
      ]))
  })

  it('keeps dashboard drill-down lists consistent with the displayed totals', () => {
    const leads = getDemoResponse<{ items: { id: string; createdAt: string }[]; total: number }>('/api/leads')
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    expect(leads.total).toBe(10)
    expect(leads.items.filter((lead) => new Date(lead.createdAt) >= monthStart)).toHaveLength(6)
    expect(getDemoResponse<{ items: { id: string }[] }>('/api/leads', { stage: 'qualified' }).items).toHaveLength(2)
    const wonDeals = getDemoResponse<{ items: { id: string; amount: number; wonAt: string; primaryContact: { phoneNumber: string } }[] }>('/api/opportunities', { stage: 'won' }).items
    expect(wonDeals).toHaveLength(3)
    expect(wonDeals.filter((deal) => new Date(deal.wonAt) >= monthStart)).toHaveLength(3)
    expect(wonDeals.reduce((sum, deal) => sum + deal.amount, 0)).toBe(325000)
    expect(wonDeals[0].primaryContact.phoneNumber).toBeTruthy()
    const trials = getDemoResponse<{ items: { id: string; account: { contacts: { phoneNumber: string }[] } }[] }>('/api/billing', { status: 'trial' }).items
    expect(trials).toHaveLength(2)
    expect(trials.every((subscription) => subscription.account.contacts[0]?.phoneNumber)).toBe(true)
    expect(getDemoResponse<{ items: { id: string }[] }>('/api/billing', { status: 'active' }).items).toHaveLength(6)
    const completedOnboarding = getDemoResponse<{ items: { id: string; account: { contacts: { phoneNumber: string }[] } }[] }>('/api/onboarding', { status: 'completed' }).items
    expect(completedOnboarding).toHaveLength(4)
    expect(completedOnboarding.every((project) => project.account.contacts[0]?.phoneNumber)).toBe(true)
    expect(getDemoResponse<{ items: { id: string }[] }>('/api/onboarding').items).toHaveLength(6)
  })

  it('serves matching records for operational snapshot details', () => {
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()
    const leads = getDemoResponse<{ items: { id: string; nextFollowUpAt: string | null }[] }>('/api/leads')
    expect(leads.items.filter((lead) =>
      lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) >= new Date(startOfDay) && new Date(lead.nextFollowUpAt) < new Date(tomorrow)
    )).toHaveLength(2)
    expect(leads.items.filter((lead) =>
      lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < new Date(startOfDay)
    )).toHaveLength(1)

    expect(getDemoResponse<{ items: { id: string }[] }>('/api/tasks', {
      dueAfter: startOfDay,
      dueBefore: tomorrow,
    }).items).toHaveLength(4)
    expect(getDemoResponse<{ items: { id: string }[] }>('/api/appointments', {
      from: startOfDay,
      to: tomorrow,
    }).items).toHaveLength(1)
    expect(getDemoResponse<{ items: { id: string }[] }>('/api/clients', {
      status: 'active',
    }).items).toHaveLength(2)
    expect(getDemoResponse<{ items: { id: string; outstandingBalance: number }[] }>('/api/clients', {
      hasOutstandingBalance: 'true',
    }).items).toEqual([expect.objectContaining({ id: 'demo-client-1', outstandingBalance: 1200 })])
  })

  it('provides contact and interaction details for account and opportunity drill-downs', () => {
    expect(getDemoResponse<{
      account: { contacts: { phoneNumber: string }[] }
      activities: { subject: string }[]
    }>('/api/accounts/demo-account-1')).toMatchObject({
      account: { contacts: [expect.objectContaining({ phoneNumber: '+919876543210' })] },
      activities: [expect.objectContaining({ subject: 'Product walkthrough with Harbor Therapy' })],
    })
    expect(getDemoResponse<{
      opportunity: { primaryContact: { phoneNumber: string } }
      activities: { subject: string }[]
    }>('/api/opportunities/demo-opportunity-3')).toMatchObject({
      opportunity: { primaryContact: { phoneNumber: '+919876543212' } },
      activities: [expect.objectContaining({ subject: 'Cedar Care plan signed' })],
    })
  })

  it('serves onboarding rows in the shape used by the onboarding page', () => {
    expect(getDemoResponse<{
      items: {
        projectName: string
        targetGoLiveDate: string
        progressPercentage: number
        account: { accountName: string }
        _count: { tasks: number }
      }[]
    }>('/api/onboarding').items[0]).toMatchObject({
      projectName: 'Harbor Therapy onboarding',
      targetGoLiveDate: expect.any(String),
      progressPercentage: 65,
      account: { accountName: 'Harbor Therapy' },
      _count: { tasks: 8 },
    })
  })

  it('does not silently invent empty data for unsupported demo endpoints', () => {
    expect(() => getDemoResponse('/api/not-implemented')).toThrow(
      'This screen is not available in demo mode: /api/not-implemented'
    )
  })

  it('saves demo leads in this browser and returns their entered details', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })
    vi.stubGlobal('crypto', { randomUUID: () => 'saved-lead-test' })

    try {
      const created = await apiRequest<{ id: string }>('/api/leads', {
        method: 'POST',
        body: {
          firstName: 'Taylor',
          lastName: 'Morgan',
          email: 'taylor@example.test',
          phone: '+919876500000',
          whatsappNumber: '+919876500001',
          organisationName: 'Morgan Wellness',
          jobTitle: 'Practice Owner',
          estimatedUsers: 12,
          currentSoftware: 'Paper records',
          painPoints: 'Scheduling is manual',
          useCase: 'Online appointments',
        },
      })
      expect(created.id).toBe('demo-lead-saved-lead-test')

      const details = await apiRequest<{
        lead: { fullName: string; email: string; phoneNumber: string; estimatedUsers: number; painPoints: string }
      }>(`/api/leads/${created.id}`)
      expect(details.lead).toMatchObject({
        fullName: 'Taylor Morgan',
        email: 'taylor@example.test',
        phoneNumber: '+919876500000',
        estimatedUsers: 12,
        painPoints: 'Scheduling is manual',
      })
      await apiRequest(`/api/leads/${created.id}`, {
        method: 'PATCH',
        body: { lifecycleStage: 'qualified', nextFollowUpAt: '2026-11-05T10:00:00.000Z' },
      })
      const updated = await apiRequest<{ lead: { lifecycleStage: string; nextFollowUpAt: string } }>(
        `/api/leads/${created.id}`
      )
      expect(updated.lead).toMatchObject({
        lifecycleStage: 'QUALIFIED',
        nextFollowUpAt: '2026-11-05T10:00:00.000Z',
      })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('saves interactions, meeting links, dead-lead changes, and manual subscription activation locally', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const storage = new Map<string, string>()
    let id = 0
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })
    vi.stubGlobal('crypto', { randomUUID: () => `interaction-${++id}` })

    try {
      await apiRequest('/api/activities', {
        method: 'POST',
        body: {
          activityType: 'meeting',
          subject: 'Product walkthrough',
          status: 'planned',
          dueAt: '2026-06-18T10:00:00.000Z',
          relatedLeadId: 'demo-lead-2',
          externalReference: 'https://calendar.google.com/calendar/render?action=TEMPLATE',
        },
      })
      await apiRequest('/api/leads/demo-lead-2', {
        method: 'PATCH',
        body: { lifecycleStage: 'lost' },
      })
      await apiRequest('/api/billing/subscriptions/demo-subscription-1', {
        method: 'PATCH',
        body: { confirmManualActivation: true },
      })

      const lead = getDemoResponse<{
        lead: { lifecycleStage: string }
        activities: { subject: string; externalReference?: string }[]
      }>('/api/leads/demo-lead-2')
      expect(lead.lead.lifecycleStage).toBe('LOST')
      expect(lead.activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ subject: 'Product walkthrough', externalReference: expect.stringContaining('calendar.google.com') }),
        expect.objectContaining({ subject: 'Lead marked as dead' }),
      ]))
      expect(getDemoResponse<{ items: { id: string }[] }>('/api/billing', { status: 'trial' }).items)
        .toHaveLength(1)
      expect(getDemoResponse<{ activities: { description: string }[] }>('/api/accounts/demo-account-1').activities)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ description: expect.stringContaining('No payment was verified or recorded') }),
        ]))
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('rejects demo writes outside the browser-local lead workflow', async () => {
    const result = await apiRequest('/api/tasks', {
      method: 'POST',
      body: { title: 'Unsupported demo write' },
    }).catch(error => error)
    expect(result).toBeInstanceOf(ApiError)
    expect(result).toMatchObject({ code: 'DEMO_READ_ONLY', status: 403 })
  })
})
