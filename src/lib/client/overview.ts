'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/lib/client/api'

/**
 * Shape of `/api/reports/overview`. Every branch is optional because the route
 * only returns the sections the viewer's role is allowed to aggregate, so an
 * absent section means "not yours to see", not "zero".
 */
export interface OverviewDashboard {
  sales?: {
    canViewLeads: boolean
    canViewOpportunities: boolean
    totalLeads: number | null
    leadsToday: number | null
    leadsThisWeek: number | null
    leadsThisMonth: number | null
    qualifiedLeads: number | null
    leadsByStage: { stage: string; count: number }[] | null
    leadsBySource: { source: string; count: number }[] | null
    pipelineValue: number | null
    weightedForecast: number | null
    openCount: number | null
    wonThisMonth: number | null
    salesThisMonth: number | null
    salesByOwner: { userId: string | null; name: string; deals: number; amount: number }[] | null
    winRate: number | null
    followupsDueToday: number | null
    overdueFollowups: number | null
  }
  success?: {
    accountsByHealth: { status: string; count: number }[]
    renewalsIn30: number
    renewalsIn60: number
    renewalsIn90: number
    onboardingActive: number | null
    onboardingCompleted: number | null
    onboardingByStatus: { status: string; count: number }[] | null
    atRiskAccounts: number
  }
  billing?: {
    trialSubscriptions: number
    paidSubscriptions: number
    subscriptionsByStatus: { status: string; count: number; amount: number }[]
  }
  management?: {
    currentMrr: number
    activeOrganisations: number
    customersByStatus: { status: string; count: number }[]
    openTickets: number
    slaBreached: number
  }
  practice?: {
    appointmentsToday: number
    activeClients: number
    newEnquiriesThisWeek: number
    outstandingBalance: number
  }
  own?: { tasksDueToday: number; overdueTasks: number }
}

export function useOverview(): UseQueryResult<{ dashboard: OverviewDashboard }, unknown> {
  return useQuery({
    queryKey: ['reports', 'overview'],
    queryFn: () => api.get<{ dashboard: OverviewDashboard }>('/api/reports/overview'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
