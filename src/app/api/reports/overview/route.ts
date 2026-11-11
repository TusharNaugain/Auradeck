/**
 * /api/reports/overview — role-aware dashboard aggregate data.
 * Sales: funnel + forecast. CSM: health + renewals. Management: revenue metrics,
 * SLA conversion. Practice: appointments + billing. All server-side aggregation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { leadScope as getLeadScope, opportunityScope as getOpportunityScope } from '@/lib/reports/scope'
import { computeWeightedAmount } from '@/lib/validations/crm'
import { computeSlaStatus } from '@/lib/validations/support'
import { v4 as uuidv4 } from 'uuid'
import { DEAD_LEAD_STAGES } from '@/lib/services/leads'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.DASHBOARD_VIEW, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  // Fetch organisation type and team members concurrently
  const [org, teamMembers] = await Promise.all([
    db.organisation.findUnique({ where: { id: organisationId }, select: { type: true } }),
    ctx.scopeType === 'TEAM' && ctx.teamId
      ? db.membership.findMany({
          where: { organisationId, teamId: ctx.teamId, status: 'ACTIVE' },
          select: { userId: true },
        })
      : Promise.resolve([]),
  ])

  const dashboard: Record<string, unknown> = {}
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const days = (n: number) => new Date(today.getTime() + n * 24 * 3600 * 1000)
  const sinceDays = (n: number) => new Date(today.getTime() - n * 24 * 3600 * 1000)
  const teamMemberIds = teamMembers.map((membership) => membership.userId)
  const leadRecordScope = getLeadScope(ctx.scopeType, user.id, ctx.teamId, teamMemberIds)
  const opportunityRecordScope = getOpportunityScope(ctx.scopeType, user.id, ctx.teamId, teamMemberIds)

  const canViewLeads = ctx.permissions.has(PERMISSIONS.LEADS_VIEW)
  const canViewOpportunities = ctx.permissions.has(PERMISSIONS.OPPORTUNITIES_VIEW)
  const canViewSuccess = ctx.permissions.has(PERMISSIONS.SUCCESS_VIEW)
  const canViewAccounts = ctx.permissions.has(PERMISSIONS.ACCOUNTS_VIEW)
  const canViewBilling = ctx.permissions.has(PERMISSIONS.BILLING_VIEW)
  const canViewClients = ctx.permissions.has(PERMISSIONS.CLIENTS_VIEW)
  const canViewAppointments = ctx.permissions.has(PERMISSIONS.APPOINTMENTS_VIEW)

  // Execute all independent reporting sections in parallel (eliminates waterfall latency)
  const [salesSection, csmSection, billingSection, managementSection, practiceSection, tasksSection] = await Promise.all([
    // 1. Sales dashboard
    (async () => {
      if (!canViewLeads && !canViewOpportunities) return null
      const [
        totalLeads,
        leadsToday,
        leadsThisWeek,
        leadsThisMonth,
        byStage,
        bySource,
        openOpps,
        wonOpps,
        lostOpps,
        wonThisMonth,
        salesByOwner,
        followupsDue,
        overdueFollowups,
      ] = await Promise.all([
        canViewLeads ? db.lead.count({ where: { organisationId, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope } }) : Promise.resolve(0),
        canViewLeads ? db.lead.count({ where: { organisationId, createdAt: { gte: startOfToday }, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope } }) : Promise.resolve(0),
        canViewLeads ? db.lead.count({ where: { organisationId, createdAt: { gte: sinceDays(7) }, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope } }) : Promise.resolve(0),
        canViewLeads ? db.lead.count({ where: { organisationId, createdAt: { gte: startOfMonth }, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope } }) : Promise.resolve(0),
        canViewLeads ? db.lead.groupBy({ by: ['lifecycleStage'], where: { organisationId, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope }, _count: true }) : Promise.resolve([]),
        canViewLeads ? db.lead.groupBy({ by: ['leadSource'], where: { organisationId, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope }, _count: true }) : Promise.resolve([]),
        canViewOpportunities ? db.opportunity.findMany({
          where: {
            organisationId,
            deletedAt: null,
            stage: { notIn: ['WON', 'LOST'] },
            ...opportunityRecordScope,
          },
          select: { amount: true, probability: true, stage: true },
        }) : Promise.resolve([]),
        canViewOpportunities ? db.opportunity.count({ where: { organisationId, stage: 'WON', deletedAt: null, ...opportunityRecordScope } }) : Promise.resolve(0),
        canViewOpportunities ? db.opportunity.count({ where: { organisationId, stage: 'LOST', deletedAt: null, ...opportunityRecordScope } }) : Promise.resolve(0),
        canViewOpportunities ? db.opportunity.findMany({
          where: {
            organisationId,
            stage: 'WON',
            deletedAt: null,
            wonAt: { gte: startOfMonth, lte: today },
            ...opportunityRecordScope,
          },
          select: {
            amount: true,
            ownerUserId: true,
            owner: { select: { fullName: true } },
          },
        }) : Promise.resolve([]),
        canViewOpportunities ? db.opportunity.groupBy({
          by: ['ownerUserId'],
          where: {
            organisationId,
            stage: 'WON',
            deletedAt: null,
            wonAt: { gte: startOfMonth, lte: today },
            ...opportunityRecordScope,
          },
          _count: true,
          _sum: { amount: true },
        }) : Promise.resolve([]),
        canViewLeads ? db.lead.count({ where: { organisationId, nextFollowUpAt: { gte: startOfToday, lte: days(1) }, deletedAt: null, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] }, ...leadRecordScope } }) : Promise.resolve(0),
        canViewLeads ? db.lead.count({ where: { organisationId, nextFollowUpAt: { lt: startOfToday }, lifecycleStage: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] }, deletedAt: null, ...leadRecordScope } }) : Promise.resolve(0),
      ])

      const pipelineValue = openOpps.reduce((sum, o) => sum + Number(o.amount), 0)
      const weightedForecast = openOpps.reduce((sum, o) => sum + computeWeightedAmount(Number(o.amount), o.probability), 0)
      const winRate = wonOpps + lostOpps === 0 ? 0 : Math.round((wonOpps / (wonOpps + lostOpps)) * 100)
      const salesThisMonth = wonThisMonth.reduce((sum, opportunity) => sum + Number(opportunity.amount), 0)
      const wonOwnersMap = new Map(wonThisMonth.map((opportunity) => [opportunity.ownerUserId, opportunity.owner?.fullName]))

      return {
        canViewLeads,
        canViewOpportunities,
        totalLeads: canViewLeads ? totalLeads : null,
        leadsToday: canViewLeads ? leadsToday : null,
        leadsThisWeek: canViewLeads ? leadsThisWeek : null,
        leadsThisMonth: canViewLeads ? leadsThisMonth : null,
        qualifiedLeads: canViewLeads ? (byStage.find((stage) => stage.lifecycleStage === 'QUALIFIED')?._count ?? 0) : null,
        leadsByStage: canViewLeads ? byStage.map((s: { lifecycleStage: string; _count: number }) => ({ stage: s.lifecycleStage, count: s._count })) : null,
        leadsBySource: canViewLeads ? bySource.map((s: { leadSource: string; _count: number }) => ({ source: s.leadSource, count: s._count })) : null,
        pipelineValue: canViewOpportunities ? pipelineValue : null,
        weightedForecast: canViewOpportunities ? Math.round(weightedForecast) : null,
        openCount: canViewOpportunities ? openOpps.length : null,
        wonThisMonth: canViewOpportunities ? wonThisMonth.length : null,
        salesThisMonth: canViewOpportunities ? salesThisMonth : null,
        salesByOwner: canViewOpportunities ? salesByOwner.map((owner) => ({
          userId: owner.ownerUserId,
          name: wonOwnersMap.get(owner.ownerUserId) ?? 'Unassigned',
          deals: owner._count,
          amount: Number(owner._sum.amount ?? 0),
        })) : null,
        winRate: canViewOpportunities ? winRate : null,
        followupsDueToday: canViewLeads ? followupsDue : null,
        overdueFollowups: canViewLeads ? overdueFollowups : null,
      }
    })(),

    // 2. CSM dashboard
    (async () => {
      if (!canViewSuccess && !canViewAccounts) return null
      const canViewOnboarding = ctx.permissions.has(PERMISSIONS.ONBOARDING_VIEW)
      const [byHealth, renewals30, renewals60, renewals90, onboardingByStatus, atRisk] = await Promise.all([
        db.account.groupBy({ by: ['healthStatus'], where: { organisationId }, _count: true }),
        db.account.count({ where: { organisationId, renewalDate: { gte: today, lte: days(30) } } }),
        db.account.count({ where: { organisationId, renewalDate: { gt: days(30), lte: days(60) } } }),
        db.account.count({ where: { organisationId, renewalDate: { gt: days(60), lte: days(90) } } }),
        canViewOnboarding
          ? db.onboardingProject.groupBy({ by: ['status'], where: { organisationId }, _count: true })
          : Promise.resolve([]),
        db.account.count({ where: { organisationId, healthStatus: { in: ['AT_RISK', 'CRITICAL'] } } }),
      ])

      return {
        accountsByHealth: byHealth.map((h: { healthStatus: string; _count: number }) => ({ status: h.healthStatus, count: h._count })),
        renewalsIn30: renewals30,
        renewalsIn60: renewals60,
        renewalsIn90: renewals90,
        onboardingActive: canViewOnboarding ? onboardingByStatus
          .filter((status) => ['SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_GO_LIVE'].includes(status.status))
          .reduce((sum, status) => sum + status._count, 0) : null,
        onboardingCompleted: canViewOnboarding
          ? onboardingByStatus.find((status) => status.status === 'COMPLETED')?._count ?? 0
          : null,
        onboardingByStatus: canViewOnboarding
          ? onboardingByStatus.map((status) => ({ status: status.status, count: status._count }))
          : null,
        atRiskAccounts: atRisk,
      }
    })(),

    // 3. Billing dashboard
    (async () => {
      if (!canViewBilling) return null
      const subscriptionsByStatus = await db.subscription.groupBy({
        by: ['status'],
        where: { organisationId },
        _count: true,
        _sum: { amount: true },
      })
      return {
        trialSubscriptions: subscriptionsByStatus.find((status) => status.status === 'TRIAL')?._count ?? 0,
        paidSubscriptions: subscriptionsByStatus.find((status) => status.status === 'ACTIVE')?._count ?? 0,
        subscriptionsByStatus: subscriptionsByStatus.map((status) => ({
          status: status.status,
          count: status._count,
          amount: Number(status._sum.amount ?? 0),
        })),
      }
    })(),

    // 4. Management dashboard (internal only)
    (async () => {
      if (org?.type !== 'AURADESK_INTERNAL' || !canViewBilling) return null
      const [currentMrr, customersByStatus, openTicketCount, openTickets] = await Promise.all([
        db.subscription.aggregate({
          where: { status: 'ACTIVE', organisationId },
          _sum: { amount: true },
        }),
        db.organisation.groupBy({ by: ['status'], where: { type: 'CUSTOMER_PRACTICE' }, _count: true }),
        db.supportTicket.count({ where: { organisationId, status: { in: ['NEW', 'OPEN'] } } }),
        db.supportTicket.findMany({
          where: { organisationId, status: { in: ['NEW', 'OPEN', 'PENDING_INTERNAL'] } },
          select: { firstResponseDueAt: true, firstRespondedAt: true, resolutionDueAt: true, resolvedAt: true },
          take: 500,
        }),
      ])
      const breached = openTickets.filter((t) => computeSlaStatus(t) === 'breached').length

      return {
        currentMrr: Number(currentMrr._sum.amount ?? 0),
        activeOrganisations: customersByStatus.find((s: { status: string }) => s.status === 'ACTIVE')?._count ?? 0,
        customersByStatus: customersByStatus.map((s: { status: string; _count: number }) => ({ status: s.status, count: s._count })),
        openTickets: openTicketCount,
        slaBreached: breached,
      }
    })(),

    // 5. Practice dashboard
    (async () => {
      if (!canViewClients && !canViewAppointments) return null
      const [appointmentsToday, enquiriesActive, newEnquiriesThisWeek, outstandingInvoices] = await Promise.all([
        db.appointment.count({ where: { organisationId, startAt: { gte: startOfToday, lte: days(1) }, status: { in: ['SCHEDULED', 'CONFIRMED'] } } }),
        db.client.count({ where: { organisationId, status: 'ACTIVE' } }),
        db.client.count({ where: { organisationId, createdAt: { gte: sinceDays(7) } } }),
        db.client.aggregate({ where: { organisationId, outstandingBalance: { gt: 0 } }, _sum: { outstandingBalance: true } }),
      ])
      return {
        appointmentsToday,
        activeClients: enquiriesActive,
        newEnquiriesThisWeek,
        outstandingBalance: Number(outstandingInvoices._sum.outstandingBalance ?? 0),
      }
    })(),

    // 6. Tasks overview (all roles)
    (async () => {
      const [myTasksDue, myOverdueTasks] = await Promise.all([
        db.task.count({ where: { organisationId, assignedToUserId: user.id, dueAt: { gte: startOfToday, lte: days(1) }, status: { notIn: ['DONE', 'CANCELLED'] } } }),
        db.task.count({ where: { organisationId, assignedToUserId: user.id, dueAt: { lt: startOfToday }, status: { notIn: ['DONE', 'CANCELLED'] } } }),
      ])
      return {
        tasksDueToday: myTasksDue,
        overdueTasks: myOverdueTasks,
      }
    })(),
  ])

  if (salesSection) dashboard.sales = salesSection
  if (csmSection) dashboard.success = csmSection
  if (billingSection) dashboard.billing = billingSection
  if (managementSection) dashboard.management = managementSection
  if (practiceSection) dashboard.practice = practiceSection
  if (tasksSection) dashboard.own = tasksSection

  return NextResponse.json(
    { success: true, data: { dashboard }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
