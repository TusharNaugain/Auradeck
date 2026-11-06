'use client'

import { useState, useMemo, memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Mail,
  Phone,
  RefreshCw,
  Target,
  TrendingUp,
  UsersRound,
  UserPlus,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { errorMessage, useHasPermission, useInvalidate } from '@/lib/client/hooks'
import { api } from '@/lib/client/api'
import { useOverview, type OverviewDashboard } from '@/lib/client/overview'
import { enumLabel, formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatRelative } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

type Bucket = { label: string; count: number }
type OperationalStatKey =
  | 'followups-due'
  | 'followups-overdue'
  | 'win-rate'
  | 'weighted-forecast'
  | 'renewals-30'
  | 'at-risk-accounts'
  | 'current-mrr'
  | 'active-organisations'
  | 'open-tickets'
  | 'sla-breached'
  | 'appointments-today'
  | 'active-clients'
  | 'new-enquiries'
  | 'outstanding-balance'
  | 'my-tasks-due'
  | 'my-tasks-overdue'
type OperationalStat = { key: OperationalStatKey; label: string; value: string; tone?: 'danger' }
type MetricKey =
  | 'leads-all'
  | 'leads-month'
  | 'leads-qualified'
  | 'opportunities-won'
  | 'opportunities-open'
  | 'subscriptions-trial'
  | 'subscriptions-active'
  | 'onboarding-active'
  | 'onboarding-completed'
type Metric = { key: MetricKey; label: string; value: string; hint: string; icon: typeof UsersRound; tone: string }

function buildMetrics(dashboard: OverviewDashboard): Metric[] {
  const metrics: Metric[] = []
  const sales = dashboard.sales
  const add = (key: MetricKey, label: string, value: string | null, hint: string, icon: Metric['icon'], tone: string) => {
    if (value !== null) metrics.push({ key, label, value, hint, icon, tone })
  }

  if (sales?.canViewLeads) {
    add('leads-all', 'Total leads', formatNumber(sales.totalLeads ?? 0), 'In your current scope', UsersRound, 'text-sky-400')
    add('leads-month', 'New leads', formatNumber(sales.leadsThisMonth ?? 0), 'Created this month', UserPlus, 'text-cyan-400')
    add('leads-qualified', 'Qualified leads', formatNumber(sales.qualifiedLeads ?? 0), 'Ready for the next step', Target, 'text-violet-400')
  }

  if (sales?.canViewOpportunities) {
    add('opportunities-won', 'Sales this month', formatCurrency(sales.salesThisMonth ?? 0, { compact: true }), 'Closed-won revenue · month to date', CircleDollarSign, 'text-emerald-400')
    add('opportunities-won', 'Deals won', formatNumber(sales.wonThisMonth ?? 0), 'Closed this month', CheckCircle2, 'text-green-400')
    add('opportunities-open', 'Open pipeline', formatCurrency(sales.pipelineValue ?? 0, { compact: true }), `${formatNumber(sales.openCount ?? 0)} open opportunities`, TrendingUp, 'text-amber-400')
  }

  if (dashboard.billing) {
    add('subscriptions-trial', 'On trial', formatNumber(dashboard.billing.trialSubscriptions), 'Trial subscriptions', Clock3, 'text-amber-400')
    add('subscriptions-active', 'Paid customers', formatNumber(dashboard.billing.paidSubscriptions), 'Active subscriptions', CircleDollarSign, 'text-emerald-400')
  }

  if (dashboard.success?.onboardingActive !== null && dashboard.success?.onboardingActive !== undefined) {
    add('onboarding-active', 'Onboarding active', formatNumber(dashboard.success.onboardingActive), 'Scheduled through go-live', BriefcaseBusiness, 'text-blue-400')
    if (dashboard.success.onboardingCompleted !== null) {
      add('onboarding-completed', 'Onboarding complete', formatNumber(dashboard.success.onboardingCompleted), 'Successfully completed', CheckCircle2, 'text-teal-400')
    }
  }

  return metrics
}

function buildSupportingStats(dashboard: OverviewDashboard) {
  const stats: OperationalStat[] = []
  const sales = dashboard.sales

  if (sales?.canViewLeads) {
    if (sales.followupsDueToday !== null) stats.push({ key: 'followups-due', label: 'Follow-ups due today', value: formatNumber(sales.followupsDueToday) })
    if (sales.overdueFollowups !== null) stats.push({ key: 'followups-overdue', label: 'Overdue follow-ups', value: formatNumber(sales.overdueFollowups), tone: sales.overdueFollowups > 0 ? 'danger' : undefined })
  }
  if (sales?.canViewOpportunities) {
    if (sales.winRate !== null) stats.push({ key: 'win-rate', label: 'Win rate', value: formatPercent(sales.winRate) })
    if (sales.weightedForecast !== null) stats.push({ key: 'weighted-forecast', label: 'Weighted forecast', value: formatCurrency(sales.weightedForecast, { compact: true }) })
  }
  if (dashboard.success) {
    stats.push(
      { key: 'renewals-30', label: 'Renewals in 30 days', value: formatNumber(dashboard.success.renewalsIn30) },
      { key: 'at-risk-accounts', label: 'At-risk accounts', value: formatNumber(dashboard.success.atRiskAccounts), tone: dashboard.success.atRiskAccounts > 0 ? 'danger' : undefined }
    )
  }
  if (dashboard.management) {
    stats.push(
      { key: 'current-mrr', label: 'Current MRR', value: formatCurrency(dashboard.management.currentMrr, { compact: true }) },
      { key: 'active-organisations', label: 'Active organisations', value: formatNumber(dashboard.management.activeOrganisations) },
      { key: 'open-tickets', label: 'Open tickets', value: formatNumber(dashboard.management.openTickets) },
      { key: 'sla-breached', label: 'SLA breached', value: formatNumber(dashboard.management.slaBreached), tone: dashboard.management.slaBreached > 0 ? 'danger' : undefined }
    )
  }
  if (dashboard.practice) {
    stats.push(
      { key: 'appointments-today', label: 'Appointments today', value: formatNumber(dashboard.practice.appointmentsToday) },
      { key: 'active-clients', label: 'Active clients', value: formatNumber(dashboard.practice.activeClients) },
      { key: 'new-enquiries', label: 'New enquiries this week', value: formatNumber(dashboard.practice.newEnquiriesThisWeek) },
      { key: 'outstanding-balance', label: 'Outstanding balance', value: formatCurrency(dashboard.practice.outstandingBalance, { compact: true }) }
    )
  }
  if (dashboard.own) {
    stats.push(
      { key: 'my-tasks-due', label: 'My tasks due today', value: formatNumber(dashboard.own.tasksDueToday) },
      { key: 'my-tasks-overdue', label: 'My overdue tasks', value: formatNumber(dashboard.own.overdueTasks), tone: dashboard.own.overdueTasks > 0 ? 'danger' : undefined }
    )
  }
  return stats
}

export default function DashboardPage() {
  const query = useOverview()
  const [selectedMetric, setSelectedMetric] = useState<Metric | null>(null)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [selectedOperationalStat, setSelectedOperationalStat] = useState<OperationalStat | null>(null)
  const dashboard = query.data?.dashboard
  const metrics = useMemo(() => (dashboard ? buildMetrics(dashboard) : []), [dashboard])
  const supportingStats = useMemo(() => (dashboard ? buildSupportingStats(dashboard) : []), [dashboard])
  const salesByOwner = dashboard?.sales?.salesByOwner

  const sortedSalesByOwner = useMemo(() => {
    if (!salesByOwner || salesByOwner.length === 0) return []
    const sorted = salesByOwner.slice().sort((a, b) => b.amount - a.amount)
    const max = Math.max(...sorted.map((item) => item.amount), 1)
    return sorted.map((rep, index) => ({
      ...rep,
      rank: index + 1,
      widthPercent: Math.round((rep.amount / max) * 100),
    }))
  }, [salesByOwner])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business overview"
        description="A clear view of leads, sales, subscriptions and customer onboarding."
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={cn('size-4', query.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {query.isError && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="Could not load"
              description={errorMessage(query.error)}
              icon={<RefreshCw className="size-5" />}
              action={<Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      )}

      {query.isPending && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-32 w-full" />)}
        </div>
      )}

      {dashboard && metrics.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="Nothing to summarise yet"
              description="Your role has no reporting scope in this workspace, or records have not been created yet."
            />
          </CardContent>
        </Card>
      )}

      {dashboard && metrics.length > 0 && (
        <>
          <section aria-label="Key business metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {metrics.map((metric) => {
              const Icon = metric.icon
              if (metric.key === 'leads-all' || metric.key === 'leads-month') {
                return (
                  <InlineLeadMetricCard
                    key={metric.key}
                    metric={metric}
                    onSelectLead={(leadId) => {
                      setSelectedRecordId(leadId)
                      setSelectedMetric(metric)
                    }}
                  />
                )
              }
              return (
                <Card key={metric.label} className="overflow-hidden border-border/70 bg-card/80 transition hover:border-primary/40 hover:shadow-md">
                  <button
                    type="button"
                    onClick={() => setSelectedMetric(metric)}
                    aria-label={`View records for ${metric.label}`}
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CardContent className="flex min-h-36 items-start justify-between gap-3 p-4">
                    <div className="min-w-0 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                      <p className="text-2xl font-semibold tabular-nums tracking-tight">{metric.value}</p>
                      <p className="text-xs text-muted-foreground">{metric.hint}</p>
                      <p className="text-xs font-medium text-primary">Click to view records →</p>
                    </div>
                    <span className={cn('rounded-lg bg-muted/70 p-2', metric.tone)}>
                      <Icon aria-hidden="true" className="size-4" />
                    </span>
                    </CardContent>
                  </button>
                </Card>
              )
            })}
          </section>
          <MetricRecordsDialog
            key={selectedMetric?.key ?? 'dialog'}
            metric={selectedMetric}
            initialSelectedId={selectedRecordId}
            onClose={() => {
              setSelectedMetric(null)
              setSelectedRecordId(null)
            }}
          />

          <section aria-label="Business performance" className="grid gap-4 xl:grid-cols-3">
            {salesByOwner && (
              <Card className="xl:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle>Sales by team member</CardTitle>
                  <p className="text-sm text-muted-foreground">Closed-won revenue this month</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {sortedSalesByOwner.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">No closed sales recorded this month.</p>
                  ) : (
                    sortedSalesByOwner.map((rep) => (
                      <div key={rep.userId ?? rep.name} className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{rep.rank}</span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{rep.name}</p>
                              <p className="text-xs text-muted-foreground">{formatNumber(rep.deals)} {rep.deals === 1 ? 'deal' : 'deals'}</p>
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCurrency(rep.amount, { compact: true })}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${rep.widthPercent}%` }} />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}

            {dashboard.sales?.leadsBySource && (
              <DistributionCard
                title="Where leads come from"
                description="Lead sources update automatically as your team records them."
                buckets={dashboard.sales.leadsBySource.map((item) => ({ label: enumLabel(item.source), count: item.count }))}
              />
            )}

            {dashboard.success?.onboardingByStatus && (
              <DistributionCard
                title="Onboarding progress"
                description="Customer projects by current onboarding stage."
                buckets={dashboard.success.onboardingByStatus.map((item) => ({ label: enumLabel(item.status), count: item.count }))}
              />
            )}
          </section>

          {dashboard.sales?.leadsByStage && dashboard.sales.leadsByStage.length > 0 && (
            <DistributionCard
              title="Lead pipeline"
              description="Leads grouped by their current stage."
              buckets={dashboard.sales.leadsByStage.map((item) => ({ label: enumLabel(item.stage), count: item.count }))}
            />
          )}

          {supportingStats.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Operational snapshot</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">Additional workload and customer-health signals.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {supportingStats.map((stat) => (
                  <Card key={stat.key} className="bg-card/60 transition hover:border-primary/40 hover:shadow-sm">
                    <button
                      type="button"
                      onClick={() => setSelectedOperationalStat(stat)}
                      aria-label={`View details for ${stat.label}`}
                      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <CardContent className="space-y-2 p-4">
                        <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                        <p className={cn('text-xl font-semibold tabular-nums', stat.tone === 'danger' && 'text-destructive')}>{stat.value}</p>
                        <p className="text-xs font-medium text-primary">Click to view details →</p>
                      </CardContent>
                    </button>
                  </Card>
                ))}
              </div>
              <OperationalDetailsDialog
                stat={selectedOperationalStat}
                onClose={() => setSelectedOperationalStat(null)}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}

type DashboardRecord = {
  id: string
  kind: 'lead' | 'opportunity' | 'subscription' | 'onboarding'
  title: string
  subtitle: string
  status: string
  contactName: string | null
  contactRole: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  date: string | null
  accountId: string | null
  amount: number | null
}

type ActivityRecord = {
  id: string
  activityType: string
  subject: string
  status: string
  createdAt: string
  dueAt?: string | null
  description?: string | null
  outcome?: string | null
}

type ContactRecord = {
  id: string
  fullName: string
  email: string | null
  phoneNumber: string | null
  whatsappNumber: string | null
  jobTitle?: string | null
  lastContactedAt?: string | null
}

type LeadRecord = {
  id: string
  fullName: string
  leadNumber: string
  email: string | null
  phoneNumber: string | null
  whatsappNumber: string | null
  organisationName: string | null
  leadSource: string
  lifecycleStage: string
  createdAt: string
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  city?: string | null
  state?: string | null
}

type RecordDetail = {
  lead?: LeadRecord & {
    alternatePhone?: string | null
    preferredContactMethod?: string | null
    website?: string | null
    city?: string | null
    state?: string | null
    jobTitle?: string | null
    sourceDetail?: string | null
    estimatedUsers?: number | null
    currentSoftware?: string | null
    painPoints?: string | null
    useCase?: string | null
    budgetRange?: string | null
    expectedTimeline?: string | null
  }
  activities?: ActivityRecord[]
  opportunity?: {
    name: string
    stage: string
    amount: string | number
    expectedCloseDate: string | null
    account: { accountName: string } | null
    primaryContact: ContactRecord | null
    owner: { fullName: string } | null
  }
  account?: {
    accountName: string
    contacts?: ContactRecord[]
    activities?: ActivityRecord[]
  }
  project?: {
    projectName: string
    status: string
    currentPhase: string | null
    targetGoLiveDate: string | null
    progressPercentage: number
    tasks: { id: string; title: string; status: string }[]
  }
}

type PageResponse<T> = { items: T[]; totalPages: number }
type OperationalRecord = {
  id: string
  title: string
  subtitle: string
  status: string | null
  date: string | null
  amount: number | null
  phone: string | null
  whatsapp: string | null
  email: string | null
}

async function loadAllPages<T>(path: string, query: Record<string, string | number> = {}): Promise<T[]> {
  const pageSize = 100
  const firstPage = await api.get<PageResponse<T>>(path, { ...query, page: 1, pageSize })
  const pages = [firstPage.items]

  for (let firstPageNumber = 2; firstPageNumber <= firstPage.totalPages; firstPageNumber += 10) {
    const pageNumbers = Array.from(
      { length: Math.min(10, firstPage.totalPages - firstPageNumber + 1) },
      (_, index) => firstPageNumber + index
    )
    const nextPages = await Promise.all(pageNumbers.map((page) =>
      api.get<PageResponse<T>>(path, { ...query, page, pageSize })
    ))
    pages.push(...nextPages.map((response) => response.items))
  }

  return pages.flat()
}

function operationalRecord(
  record: Partial<OperationalRecord> & Pick<OperationalRecord, 'id' | 'title'>,
  defaults: Partial<Omit<OperationalRecord, 'id' | 'title'>> = {}
): OperationalRecord {
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle ?? defaults.subtitle ?? '',
    status: record.status ?? defaults.status ?? null,
    date: record.date ?? defaults.date ?? null,
    amount: record.amount ?? defaults.amount ?? null,
    phone: record.phone ?? defaults.phone ?? null,
    whatsapp: record.whatsapp ?? defaults.whatsapp ?? null,
    email: record.email ?? defaults.email ?? null,
  }
}

async function loadOperationalRecords(key: OperationalStatKey): Promise<OperationalRecord[]> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

  if (key === 'followups-due' || key === 'followups-overdue') {
    const leads = await loadAllPages<LeadRecord>('/api/leads')
    return leads
      .filter((lead) => {
        if (!lead.nextFollowUpAt || ['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(lead.lifecycleStage)) return false
        const dueAt = new Date(lead.nextFollowUpAt)
        return key === 'followups-due'
          ? dueAt >= todayStart && dueAt < tomorrowStart
          : dueAt < todayStart
      })
      .map((lead) => operationalRecord({
        id: lead.id,
        title: lead.fullName,
        subtitle: lead.organisationName || lead.leadNumber,
        status: lead.lifecycleStage,
        date: lead.nextFollowUpAt,
        phone: lead.phoneNumber,
        whatsapp: lead.whatsappNumber,
        email: lead.email,
      }))
  }

  if (key === 'win-rate' || key === 'weighted-forecast') {
    const opportunities = await loadAllPages<{
      id: string
      name: string
      stage: string
      amount: number | string
      weightedAmount?: number | string
      account: { accountName: string } | null
      primaryContact?: {
        fullName: string
        phoneNumber?: string | null
        whatsappNumber?: string | null
        email: string | null
      } | null
      expectedCloseDate?: string | null
      wonAt?: string | null
    }>('/api/opportunities')
    return opportunities
      .filter((opportunity) => key === 'win-rate'
        ? ['WON', 'LOST'].includes(opportunity.stage)
        : !['WON', 'LOST'].includes(opportunity.stage))
      .map((opportunity) => operationalRecord({
        id: opportunity.id,
        title: opportunity.name,
        subtitle: `${opportunity.account?.accountName ?? 'No account'}${opportunity.primaryContact?.fullName ? ` · ${opportunity.primaryContact.fullName}` : ''}`,
        status: opportunity.stage,
        date: opportunity.wonAt ?? opportunity.expectedCloseDate ?? null,
        amount: Number(key === 'weighted-forecast' ? opportunity.weightedAmount ?? opportunity.amount : opportunity.amount),
        phone: opportunity.primaryContact?.phoneNumber ?? null,
        whatsapp: opportunity.primaryContact?.whatsappNumber ?? null,
        email: opportunity.primaryContact?.email ?? null,
      }))
  }

  if (key === 'renewals-30' || key === 'at-risk-accounts') {
    const accounts = await loadAllPages<{
      id: string
      accountName: string
      healthStatus: string
      healthScore: number
      renewalDate: string | null
      mrr: number | string | null
      contacts?: ContactRecord[]
    }>('/api/accounts', key === 'renewals-30' ? { renewalWithinDays: 30 } : {})
    return accounts
      .filter((account) => key === 'renewals-30'
        ? Boolean(account.renewalDate && new Date(account.renewalDate) >= now && new Date(account.renewalDate) <= new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))
        : ['AT_RISK', 'CRITICAL'].includes(account.healthStatus))
      .map((account) => {
        const contact = account.contacts?.[0]
        return operationalRecord({
          id: account.id,
          title: account.accountName,
          subtitle: contact ? `${contact.fullName}${contact.jobTitle ? ` · ${contact.jobTitle}` : ''}` : `Health score ${account.healthScore}`,
          status: account.healthStatus,
          date: account.renewalDate,
          amount: Number(account.mrr ?? 0),
          phone: contact?.phoneNumber ?? null,
          whatsapp: contact?.whatsappNumber ?? null,
          email: contact?.email ?? null,
        })
      })
  }

  if (key === 'current-mrr') {
    const subscriptions = await loadAllPages<{
      id: string
      status: string
      amount: number | string
      renewalDate: string | null
      account: { accountName: string; contacts?: ContactRecord[] }
      plan: { name: string } | null
    }>('/api/billing', { status: 'active' })
    return subscriptions.map((subscription) => {
      const contact = subscription.account.contacts?.[0]
      return operationalRecord({
        id: subscription.id,
        title: subscription.account.accountName,
        subtitle: `${subscription.plan?.name ?? 'Subscription'}${contact ? ` · ${contact.fullName}` : ''}`,
        status: subscription.status,
        date: subscription.renewalDate,
        amount: Number(subscription.amount),
        phone: contact?.phoneNumber ?? null,
        whatsapp: contact?.whatsappNumber ?? null,
        email: contact?.email ?? null,
      })
    })
  }

  if (key === 'active-organisations') {
    const organisations = await loadAllPages<{
      id: string
      displayName: string
      status: string
      city: string | null
      state: string | null
      createdAt: string
    }>('/api/reports/organisations')
    return organisations.map((organisation) => operationalRecord({
      id: organisation.id,
      title: organisation.displayName,
      subtitle: [organisation.city, organisation.state].filter(Boolean).join(', ') || 'Customer practice',
      status: organisation.status,
      date: organisation.createdAt,
    }))
  }

  if (key === 'open-tickets' || key === 'sla-breached') {
    const tickets = await loadAllPages<{
      id: string
      ticketNumber: string
      subject: string
      status: string
      priority: string
      slaStatus: string
      createdAt: string
      account: { accountName: string } | null
      assignedTo: { fullName: string } | null
    }>('/api/tickets', key === 'sla-breached' ? { slaStatus: 'breached' } : {})
    return tickets
      .filter((ticket) => key === 'sla-breached'
        ? ticket.slaStatus === 'BREACHED' && ['NEW', 'OPEN', 'PENDING_INTERNAL'].includes(ticket.status)
        : ['NEW', 'OPEN'].includes(ticket.status))
      .map((ticket) => operationalRecord({
        id: ticket.id,
        title: ticket.subject,
        subtitle: `${ticket.ticketNumber} · ${ticket.priority} priority${ticket.account ? ` · ${ticket.account.accountName}` : ''}${ticket.assignedTo ? ` · ${ticket.assignedTo.fullName}` : ''}`,
        status: ticket.status,
        date: ticket.createdAt,
      }))
  }

  if (key === 'appointments-today') {
    const appointments = await loadAllPages<{
      id: string
      startAt: string
      status: string
      appointmentType: string
      client: { firstName: string; lastName: string; preferredName: string | null }
    }>('/api/appointments', {
      from: todayStart.toISOString(),
      to: tomorrowStart.toISOString(),
    })
    return appointments.map((appointment) => operationalRecord({
      id: appointment.id,
      title: appointment.client.preferredName || `${appointment.client.firstName} ${appointment.client.lastName}`,
      subtitle: enumLabel(appointment.appointmentType),
      status: appointment.status,
      date: appointment.startAt,
    }))
  }

  if (key === 'active-clients' || key === 'new-enquiries' || key === 'outstanding-balance') {
    const clients = await loadAllPages<{
      id: string
      clientNumber: string
      firstName: string
      lastName: string
      preferredName: string | null
      status: string
      lastAppointmentAt: string | null
      nextAppointmentAt: string | null
      outstandingBalance: number | string
      createdAt: string
    }>('/api/clients', key === 'active-clients'
      ? { status: 'active' }
      : key === 'outstanding-balance' ? { hasOutstandingBalance: 'true' } : {})
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return clients
      .filter((client) => key !== 'new-enquiries' || new Date(client.createdAt) >= weekStart)
      .filter((client) => key !== 'outstanding-balance' || Number(client.outstandingBalance) > 0)
      .map((client) => operationalRecord({
        id: client.id,
        title: client.preferredName || `${client.firstName} ${client.lastName}`,
        subtitle: client.clientNumber,
        status: client.status,
        date: key === 'new-enquiries' ? client.createdAt : client.nextAppointmentAt ?? client.lastAppointmentAt,
        amount: key === 'outstanding-balance' ? Number(client.outstandingBalance) : null,
      }))
  }

  const tasks = await loadAllPages<{
    id: string
    title: string
    status: string
    priority: string
    dueAt: string | null
    relatedEntityType: string | null
    assignedTo: { fullName: string } | null
  }>('/api/tasks', key === 'my-tasks-overdue'
    ? { overdue: 'true' }
    : { dueAfter: todayStart.toISOString(), dueBefore: tomorrowStart.toISOString() })
  return tasks
    .filter((task) => key === 'my-tasks-overdue'
      ? task.dueAt !== null && new Date(task.dueAt) < todayStart && !['DONE', 'CANCELLED'].includes(task.status)
      : task.dueAt !== null && new Date(task.dueAt) >= todayStart && new Date(task.dueAt) < tomorrowStart && !['DONE', 'CANCELLED'].includes(task.status))
    .map((task) => operationalRecord({
      id: task.id,
      title: task.title,
      subtitle: `${task.assignedTo?.fullName ?? 'Unassigned'}${task.relatedEntityType ? ` · ${enumLabel(task.relatedEntityType)}` : ''}`,
      status: task.status,
      date: task.dueAt,
    }, { status: `${task.priority} priority` }))
}

async function loadMetricRecords(metric: Metric): Promise<DashboardRecord[]> {
  if (metric.key.startsWith('leads-')) {
    const query: Record<string, string | number> = {}
    if (metric.key === 'leads-qualified') query.stage = 'qualified'
    const items = await loadAllPages<LeadRecord>('/api/leads', query)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    return items
      .filter((lead) => metric.key !== 'leads-month' || new Date(lead.createdAt) >= monthStart)
      .map((lead) => ({
        id: lead.id,
        kind: 'lead' as const,
        title: lead.fullName,
        subtitle: lead.organisationName || lead.leadNumber,
        status: lead.lifecycleStage,
        phone: lead.phoneNumber,
        contactName: lead.fullName,
        contactRole: null,
        whatsapp: lead.whatsappNumber,
        email: lead.email,
        date: lead.lastContactedAt,
        accountId: null,
        amount: null,
      }))
  }

  if (metric.key.startsWith('opportunities-')) {
    const query = metric.key === 'opportunities-won' ? { stage: 'won' } : undefined
    const items = await loadAllPages<{
        id: string
        name: string
        stage: string
        amount: number | string
        wonAt?: string | null
        createdAt: string
        primaryContact?: {
          fullName: string
          jobTitle?: string | null
          phoneNumber?: string | null
          whatsappNumber?: string | null
          email: string | null
        } | null
        account: { id: string; accountName: string } | null
      }>('/api/opportunities', query)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    return items
      .filter((item) => metric.key !== 'opportunities-open' || !['WON', 'LOST'].includes(item.stage))
      .filter((item) => metric.key !== 'opportunities-won' || (item.wonAt ? new Date(item.wonAt) >= monthStart : new Date(item.createdAt) >= monthStart))
      .map((item) => ({
        id: item.id,
        kind: 'opportunity' as const,
        title: item.name,
        subtitle: item.account?.accountName || 'No account linked',
        status: item.stage,
        contactName: item.primaryContact?.fullName ?? null,
        contactRole: item.primaryContact?.jobTitle ?? null,
        phone: item.primaryContact?.phoneNumber ?? null,
        whatsapp: item.primaryContact?.whatsappNumber ?? null,
        email: item.primaryContact?.email ?? null,
        date: item.wonAt ?? item.createdAt,
        accountId: item.account?.id ?? null,
        amount: Number(item.amount),
      }))
  }

  if (metric.key.startsWith('subscriptions-')) {
    const status = metric.key === 'subscriptions-trial' ? 'trial' : 'active'
    const items = await loadAllPages<{
        id: string
        accountId: string
        status: string
        amount: number | string
        renewalDate: string | null
        account: { id: string; accountName: string; contacts?: ContactRecord[] }
        plan: { name: string } | null
      }>('/api/billing', { status })
    return items.map((item) => ({
      id: item.id,
      kind: 'subscription' as const,
      title: item.account.accountName,
      subtitle: item.plan?.name ?? 'Subscription',
      status: item.status,
      contactName: item.account.contacts?.[0]?.fullName ?? null,
      contactRole: item.account.contacts?.[0]?.jobTitle ?? null,
      phone: item.account.contacts?.[0]?.phoneNumber ?? null,
      whatsapp: item.account.contacts?.[0]?.whatsappNumber ?? null,
      email: item.account.contacts?.[0]?.email ?? null,
      date: item.renewalDate,
      accountId: item.account.id || item.accountId,
      amount: Number(item.amount),
    }))
  }

  const items = await loadAllPages<{
      id: string
      projectName: string
      status: string
      targetGoLiveDate: string | null
      account: { id: string; accountName: string; contacts?: ContactRecord[] } | null
    }>('/api/onboarding')
  return items
    .filter((item) => metric.key !== 'onboarding-completed'
      ? ['SCHEDULED', 'IN_PROGRESS', 'BLOCKED', 'READY_FOR_GO_LIVE'].includes(item.status)
      : item.status === 'COMPLETED')
    .map((item) => ({
      id: item.id,
      kind: 'onboarding' as const,
      title: item.account?.accountName ?? item.projectName,
      subtitle: item.projectName,
      status: item.status,
      contactName: item.account?.contacts?.[0]?.fullName ?? null,
      contactRole: item.account?.contacts?.[0]?.jobTitle ?? null,
      phone: item.account?.contacts?.[0]?.phoneNumber ?? null,
      whatsapp: item.account?.contacts?.[0]?.whatsappNumber ?? null,
      email: item.account?.contacts?.[0]?.email ?? null,
      date: item.targetGoLiveDate,
      accountId: item.account?.id ?? null,
      amount: null,
    }))
}

function OperationalDetailsDialog({
  stat,
  onClose,
}: {
  stat: OperationalStat | null
  onClose: () => void
}) {
  const recordsQuery = useQuery({
    queryKey: ['dashboard', 'operational-records', stat?.key],
    queryFn: () => loadOperationalRecords(stat!.key),
    enabled: stat !== null,
    staleTime: 60_000,
  })

  return (
    <Dialog open={stat !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{stat?.label} · {stat?.value}</DialogTitle>
          <DialogDescription>
            {recordsQuery.data
              ? `${formatNumber(recordsQuery.data.length)} matching records. Details and available contact options are listed below.`
              : 'Loading matching records…'}
          </DialogDescription>
        </DialogHeader>

        {recordsQuery.isPending ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
        ) : recordsQuery.isError ? (
          <EmptyState
            title="Could not load details"
            description={errorMessage(recordsQuery.error)}
            action={<Button variant="outline" size="sm" onClick={() => void recordsQuery.refetch()}>Retry</Button>}
          />
        ) : recordsQuery.data?.length ? (
          <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-2">
            {recordsQuery.data.map((record) => (
              <article key={record.id} className="rounded-lg border border-border/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{record.title}</p>
                    {record.subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{record.subtitle}</p>}
                  </div>
                  {record.status && <Badge variant="outline" className="shrink-0">{enumLabel(record.status)}</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {record.date && <span>{formatDateTime(record.date)}</span>}
                  {record.amount !== null && <span>{formatCurrency(record.amount)}</span>}
                </div>
                {(record.phone || record.email) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {record.phone && <RecordContactAction icon={Phone} label={record.phone} href={`tel:${record.phone}`} />}
                    {record.email && <RecordContactAction icon={Mail} label={record.email} href={`mailto:${record.email}`} />}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No matching records" description="There are no records for this signal right now." />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InlineLeadMetricCard({
    metric,
    onSelectLead,
}: {
    metric: Metric
    onSelectLead: (leadId: string) => void
}) {
    const leadsQuery = useQuery({
      queryKey: ['dashboard', 'inline-leads'],
      queryFn: () => api.get<PageResponse<LeadRecord>>('/api/leads', { page: 1, pageSize: 50 }).then(r => r.items),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    })
    const Icon = metric.icon
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const leads = (leadsQuery.data ?? []).filter((lead) =>
      metric.key !== 'leads-month' || new Date(lead.createdAt) >= monthStart
    )

    return (
      <Card className="flex min-h-0 flex-col overflow-hidden border-border/70 bg-card/80">
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-sm font-medium">{metric.label}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {metric.key === 'leads-month' ? 'People added this month' : 'People in your current scope'}
            </p>
          </div>
          <span className={cn('rounded-lg bg-muted/70 p-2', metric.tone)}>
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {leadsQuery.isPending ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
          ) : leadsQuery.isError ? (
            <EmptyState
              title="Could not load leads"
              description={errorMessage(leadsQuery.error)}
              action={<Button variant="outline" size="sm" onClick={() => void leadsQuery.refetch()}>Retry</Button>}
            />
          ) : leads.length ? (
            <div className="max-h-80 space-y-2 overflow-y-auto pr-2">
              {leads.map((lead) => (
                <article key={lead.id} className="rounded-lg border border-border/70 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onSelectLead(lead.id)}
                        className="block max-w-full truncate text-left text-sm font-semibold hover:text-primary hover:underline"
                        aria-label={`View details for ${lead.fullName}`}
                      >
                        {lead.fullName}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">
                        {lead.organisationName || lead.leadNumber}
                        {(lead.city || lead.state) && ` · ${[lead.city, lead.state].filter(Boolean).join(', ')}`}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{enumLabel(lead.lifecycleStage)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {lead.phoneNumber && <RecordContactAction icon={Phone} label={lead.phoneNumber} href={`tel:${lead.phoneNumber}`} />}
                    {lead.email && <RecordContactAction icon={Mail} label={lead.email} href={`mailto:${lead.email}`} />}
                    {!lead.phoneNumber && !lead.email && (
                      <span className="text-xs text-muted-foreground">No contact details added</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No leads found" description="Leads matching this list will appear here." />
          )}
        </CardContent>
      </Card>
    )
}

async function loadRecordDetail(record: DashboardRecord): Promise<RecordDetail> {
  if (record.kind === 'lead') {
    return api.get<RecordDetail>(`/api/leads/${record.id}`)
  }
  if (record.kind === 'opportunity') {
    return api.get<RecordDetail>(`/api/opportunities/${record.id}`)
  }
  if (record.kind === 'subscription') {
    if (!record.accountId) return {}
    return api.get<RecordDetail>(`/api/accounts/${record.accountId}`)
  }
  const [project, account] = await Promise.all([
    api.get<{ project: RecordDetail['project'] }>(`/api/onboarding/${record.id}`),
    record.accountId ? api.get<{ account: RecordDetail['account'] }>(`/api/accounts/${record.accountId}`) : Promise.resolve(null),
  ])
  return {
    project: project.project ?? undefined,
    account: account?.account,
  }
}

function MetricRecordsDialog({
  metric,
  initialSelectedId,
  onClose,
}: {
  metric: Metric | null
  initialSelectedId: string | null
  onClose: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const recordsQuery = useQuery({
    queryKey: ['dashboard', 'metric-records', metric?.key],
    queryFn: () => loadMetricRecords(metric!),
    enabled: metric !== null,
    staleTime: 60_000,
  })
  const selectedRecord = useMemo(
    () => recordsQuery.data?.find((record) => record.id === selectedId) ?? null,
    [recordsQuery.data, selectedId]
  )
  const detailQuery = useQuery({
    queryKey: ['dashboard', 'metric-record', selectedRecord?.kind, selectedRecord?.id],
    queryFn: () => loadRecordDetail(selectedRecord!),
    enabled: selectedRecord !== null,
    staleTime: 60_000,
  })

  return (
    <Dialog open={metric !== null} onOpenChange={(open) => { if (!open) { setSelectedId(null); onClose() } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{metric?.label} · {metric?.value}</DialogTitle>
          <DialogDescription>
            {recordsQuery.data
              ? `${formatNumber(recordsQuery.data.length)} records. Contact names and available call and email links are shown below.`
              : 'Loading records and contact options…'}
          </DialogDescription>
        </DialogHeader>

        {recordsQuery.isPending ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
        ) : recordsQuery.isError ? (
          <EmptyState title="Could not load records" description={errorMessage(recordsQuery.error)} action={<Button variant="outline" size="sm" onClick={() => void recordsQuery.refetch()}>Retry</Button>} />
        ) : recordsQuery.data?.length ? (
          <div className="max-h-64 overflow-y-auto pr-3">
            <div className="space-y-2">
              {recordsQuery.data.map((record) => (
                <div
                  key={record.id}
                  className={cn(
                    'rounded-lg border p-3 transition',
                    selectedId === record.id ? 'border-primary bg-muted/40' : 'border-border/70'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedId(record.id)}
                        className="block max-w-full truncate text-left text-sm font-semibold hover:text-primary hover:underline"
                      >
                        {record.title}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">{record.subtitle}</p>
                      <p className="mt-1 text-sm">
                        {record.contactName
                          ? <>{record.contactName}{record.contactRole ? <span className="text-muted-foreground"> · {record.contactRole}</span> : null}</>
                          : <span className="text-muted-foreground">Contact details unavailable</span>}
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline">{enumLabel(record.status)}</Badge>
                      {record.amount !== null && <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(record.amount)}</span>}
                      {record.date && <span className="text-xs text-muted-foreground">{formatRelative(record.date)}</span>}
                    </span>
                  </div>
                  {(record.phone || record.email) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {record.phone && <RecordContactAction icon={Phone} label={record.phone} href={`tel:${record.phone}`} />}
                      {record.email && <RecordContactAction icon={Mail} label={record.email} href={`mailto:${record.email}`} />}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="No matching records" description="No records were found for this metric in the current workspace." />
        )}

        {selectedRecord && (
          <section className="space-y-3 rounded-xl border border-border/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{selectedRecord.title}</h3>
                <p className="text-sm text-muted-foreground">{selectedRecord.subtitle}</p>
              </div>
              <Badge variant="secondary">{enumLabel(selectedRecord.status)}</Badge>
            </div>
            {detailQuery.isPending ? <Skeleton className="h-28 w-full" /> : detailQuery.isError ? (
              <p className="text-sm text-destructive">{errorMessage(detailQuery.error)}</p>
            ) : (
              <RecordDetailContent record={selectedRecord} detail={detailQuery.data ?? {}} />
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecordContactAction({
  icon: Icon,
  label,
  href,
}: {
  icon: typeof Phone
  label: string
  href: string
}) {
  return (
    <a
      href={href}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-muted hover:text-foreground"
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  )
}

function RecordDetailContent({ record, detail }: { record: DashboardRecord; detail: RecordDetail }) {
  const canManageBilling = useHasPermission('billing.manage')
  const invalidate = useInvalidate()
  const [activationPending, setActivationPending] = useState(false)
  const contact = detail.lead
    ? {
        name: detail.lead.fullName,
        phone: detail.lead.phoneNumber,
        whatsapp: detail.lead.whatsappNumber,
        email: detail.lead.email,
        lastContactedAt: detail.lead.lastContactedAt,
      }
    : detail.opportunity?.primaryContact
      ? {
          name: detail.opportunity.primaryContact.fullName,
          phone: detail.opportunity.primaryContact.phoneNumber,
          whatsapp: detail.opportunity.primaryContact.whatsappNumber,
          email: detail.opportunity.primaryContact.email,
          lastContactedAt: null,
        }
      : detail.account?.contacts?.[0]
        ? {
            name: detail.account.contacts[0].fullName,
            phone: detail.account.contacts[0].phoneNumber,
            whatsapp: detail.account.contacts[0].whatsappNumber,
            email: detail.account.contacts[0].email,
            lastContactedAt: detail.account.contacts[0].lastContactedAt ?? null,
          }
        : null
  const activities = detail.activities ?? detail.account?.activities ?? []

  async function markSubscriptionActive() {
    if (!window.confirm('Manually mark this subscription active? This does not verify or record a payment.')) return
    setActivationPending(true)
    try {
      await api.patch(`/api/billing/subscriptions/${record.id}`, { confirmManualActivation: true })
      toast.success('Subscription marked active manually')
      invalidate(['dashboard', 'metric-records'])
      invalidate(['dashboard', 'metric-record'])
      invalidate(['billing'])
      invalidate(['reports', 'overview'])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setActivationPending(false)
    }
  }

  return (
    <div className="space-y-4">
      {detail.project && (
        <div className="grid gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <DetailItem label="Project" value={detail.project.projectName} />
          <DetailItem label="Phase" value={detail.project.currentPhase || enumLabel(detail.project.status)} />
          <DetailItem label="Target go-live" value={formatDate(detail.project.targetGoLiveDate)} />
          <DetailItem label="Progress" value={`${detail.project.progressPercentage}%`} />
          <DetailItem label="Tasks" value={formatNumber(detail.project.tasks.length)} />
        </div>
      )}
      {detail.opportunity && (
        <div className="grid gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <DetailItem label="Opportunity" value={detail.opportunity.name} />
          <DetailItem label="Account" value={detail.opportunity.account?.accountName ?? 'Not linked'} />
          <DetailItem label="Owner" value={detail.opportunity.owner?.fullName ?? 'Unassigned'} />
          <DetailItem label="Amount" value={formatCurrency(detail.opportunity.amount)} />
          <DetailItem label="Expected close" value={formatDate(detail.opportunity.expectedCloseDate)} />
        </div>
      )}
      {record.kind === 'subscription' && (
        <div className="space-y-3 rounded-lg bg-muted/30 p-3">
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <DetailItem label="Subscription" value={record.subtitle} />
            <DetailItem label="Amount" value={record.amount === null ? '—' : formatCurrency(record.amount)} />
            <DetailItem label="Renewal" value={formatDate(record.date)} />
          </div>
          {canManageBilling && ['TRIAL', 'PAST_DUE'].includes(record.status) && (
            <div className="space-y-1">
              <Button size="sm" onClick={() => void markSubscriptionActive()} disabled={activationPending}>
                {activationPending ? 'Saving…' : 'Mark active (manual)'}
              </Button>
              <p className="text-xs text-muted-foreground">Changes the CRM subscription status only; it does not verify or record a payment.</p>
            </div>
          )}
        </div>
      )}
      {contact && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact details</h4>
          <p className="mb-2 text-sm font-medium">{contact.name}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <DetailContact icon={Phone} label="Phone" value={contact.phone} href={contact.phone ? `tel:${contact.phone}` : undefined} />
            {detail.lead?.alternatePhone && <DetailContact icon={Phone} label="Alternate phone" value={detail.lead.alternatePhone} href={`tel:${detail.lead.alternatePhone}`} />}
            <DetailContact icon={Mail} label="Email" value={contact.email} href={contact.email ? `mailto:${contact.email}` : undefined} />
            {contact.lastContactedAt && <DetailContact icon={Clock3} label="Last interaction" value={formatRelative(contact.lastContactedAt)} />}
          </div>
        </div>
      )}
      {detail.lead && (
        <div className="grid gap-3 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2">
          {detail.lead.jobTitle && <DetailItem label="Job title" value={detail.lead.jobTitle} />}
          {detail.lead.preferredContactMethod && <DetailItem label="Preferred contact" value={enumLabel(detail.lead.preferredContactMethod)} />}
          {detail.lead.website && <DetailItem label="Website" value={detail.lead.website} />}
          {detail.lead.city && <DetailItem label="City" value={detail.lead.city} />}
          {detail.lead.state && <DetailItem label="State" value={detail.lead.state} />}
          {detail.lead.currentSoftware && <DetailItem label="Current software" value={detail.lead.currentSoftware} />}
          {detail.lead.estimatedUsers !== null && detail.lead.estimatedUsers !== undefined && <DetailItem label="Expected users" value={formatNumber(detail.lead.estimatedUsers)} />}
          {detail.lead.budgetRange && <DetailItem label="Budget" value={detail.lead.budgetRange} />}
          {detail.lead.expectedTimeline && <DetailItem label="Timeline" value={detail.lead.expectedTimeline} />}
          {detail.lead.sourceDetail && <DetailItem label="Source details" value={detail.lead.sourceDetail} />}
          {detail.lead.painPoints && <DetailItem label="Pain points" value={detail.lead.painPoints} />}
          {detail.lead.useCase && <DetailItem label="Use case" value={detail.lead.useCase} />}
        </div>
      )}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Interaction history</h4>
        {activities.length ? (
          <div className="space-y-2">
            {activities.map((activity) => (
              <div key={activity.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{activity.subject}</p>
                  <span className="text-xs text-muted-foreground">{formatDateTime(activity.createdAt)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{enumLabel(activity.activityType)} · {enumLabel(activity.status)}</p>
                {activity.description && <p className="mt-2 whitespace-pre-wrap text-sm">{activity.description}</p>}
                {activity.outcome && <p className="mt-2 text-sm"><span className="font-medium">Outcome:</span> {activity.outcome}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No interactions have been logged yet.</p>
        )}
      </div>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 break-words font-medium">{value}</p></div>
}

function DetailContact({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Phone
  label: string
  value: string | null | undefined
  href?: string
}) {
  return (
    <div className="flex min-w-0 gap-2 rounded-lg border border-border/60 p-2.5">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {value ? href ? <a className="break-all text-sm hover:underline" href={href}>{value}</a> : <p className="break-all text-sm">{value}</p> : <p className="text-sm text-muted-foreground">Not added</p>}
      </div>
    </div>
  )
}

const DistributionCard = memo(function DistributionCard({
  title,
  description,
  buckets,
}: {
  title: string
  description: string
  buckets: Bucket[]
}) {
  const total = useMemo(() => buckets.reduce((sum, bucket) => sum + bucket.count, 0), [buckets])
  const max = useMemo(() => buckets.reduce((best, bucket) => Math.max(best, bucket.count), 0), [buckets])
  const sortedBuckets = useMemo(() => buckets.slice().sort((a, b) => b.count - a.count), [buckets])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No records yet. Counts will appear as data is added.</p>
        ) : (
          sortedBuckets.map((bucket) => (
            <div key={bucket.label} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{bucket.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatNumber(bucket.count)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/80"
                  style={{ width: `${max === 0 ? 0 : Math.round((bucket.count / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
})
