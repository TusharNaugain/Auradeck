'use client'

import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SchemaForm, type FieldSpec } from '@/components/shared/schema-form'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api, ApiError } from '@/lib/client/api'
import { errorMessage, useHasPermission, useInvalidate } from '@/lib/client/hooks'
import { enumLabel, formatCurrency, formatDate, formatDateTime, formatNumber, formatRelative, isOverdue } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { DEMO_MODE } from '@/lib/demo-mode'
import { leadCreateSchema, leadSource, preferredContactMethod } from '@/lib/validations/crm'
import { toast } from 'sonner'
import { createGoogleCalendarLink } from '@/lib/client/calendar-link'

const createFields: FieldSpec[] = [
  { name: 'firstName', label: 'First name', kind: 'text', half: true },
  { name: 'lastName', label: 'Last name', kind: 'text', half: true },
  { name: 'email', label: 'Email', kind: 'email', half: true },
  { name: 'phone', label: 'Phone', kind: 'tel', half: true },
  { name: 'whatsappNumber', label: 'WhatsApp', kind: 'tel', half: true },
  { name: 'alternatePhone', label: 'Alternate phone', kind: 'tel', half: true },
  { name: 'preferredContactMethod', label: 'Preferred contact', kind: 'select', options: preferredContactMethod, half: true },
  { name: 'organisationName', label: 'Practice / organisation', kind: 'text', half: true },
  { name: 'jobTitle', label: 'Job title', kind: 'text', half: true },
  { name: 'leadSource', label: 'Source', kind: 'select', options: leadSource, half: true },
  { name: 'sourceDetail', label: 'Source details', kind: 'text', half: true },
  { name: 'website', label: 'Website', kind: 'url', half: true },
  { name: 'city', label: 'City', kind: 'text', half: true },
  { name: 'state', label: 'State', kind: 'text', half: true },
  { name: 'nextFollowUpAt', label: 'Next follow-up', kind: 'datetime', half: true },
  { name: 'estimatedUsers', label: 'Expected users', kind: 'number', half: true },
  { name: 'currentSoftware', label: 'Current software', kind: 'text', half: true },
  { name: 'budgetRange', label: 'Budget range', kind: 'text', half: true },
  { name: 'expectedTimeline', label: 'Expected timeline', kind: 'text', half: true },
  { name: 'painPoints', label: 'Pain points', kind: 'textarea' },
  { name: 'useCase', label: 'Use case', kind: 'textarea' },
]

const LEAD_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'DEMO_BOOKED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'CONVERTED',
  'LOST',
  'DISQUALIFIED',
] as const

type LeadStage = typeof LEAD_STAGES[number]
type LeadSummary = {
  id: string
  leadNumber: string
  fullName: string
  email: string | null
  organisationName: string | null
  leadSource: string
  lifecycleStage: LeadStage
  leadScore: number
  assignedToUserId: string | null
  assignedTo: { id: string; fullName: string } | null
  nextFollowUpAt: string | null
  lastContactedAt: string | null
  createdAt: string
  city: string | null
  state: string | null
  tags: string[]
  phoneNumber: string | null
  whatsappNumber: string | null
}

type LeadActivity = {
  id: string
  activityType: string
  subject: string
  status: string
  description?: string | null
  outcome?: string | null
  createdAt: string
  dueAt: string | null
  externalReference?: string | null
}

type LeadDetails = LeadSummary & {
  phoneCountryCode?: string | null
  alternatePhone?: string | null
  website?: string | null
  sourceDetail?: string | null
  jobTitle?: string | null
  country?: string | null
  preferredContactMethod?: string | null
  estimatedPracticeSize?: string | null
  estimatedUsers?: number | null
  currentSoftware?: string | null
  painPoints?: string | null
  useCase?: string | null
  budgetRange?: string | null
  expectedTimeline?: string | null
  qualificationStatus?: string | null
  consentStatus?: string | null
  consentSource?: string | null
  customFields?: Record<string, unknown> | null
  assignedTo?: { id: string; fullName: string; avatarUrl?: string | null } | null
  convertedAccount?: {
    id: string
    accountName: string
    paymentStatus: string | null
    mrr: string | number | null
    subscriptions: { id: string; status: string; startDate: string; renewalDate: string | null; amount: string | number; currency: string }[]
    invoices: {
      invoiceNumber: string
      status: string
      issueDate: string
      dueDate: string
      total: string | number
      amountPaid: string | number
      amountDue: string | number
      payments: { paidAt: string | null; amount: string | number; currency: string }[]
    }[]
    onboardingProjects: { status: string; targetGoLiveDate: string | null; progressPercentage: number }[]
  } | null
}

type LeadListResponse = {
  items: LeadSummary[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  stageCounts: { stage: LeadStage; count: number }[]
}

type LeadDetailsResponse = { lead: LeadDetails; activities: LeadActivity[] }

const CUSTOM_FIELD_LABELS: Record<string, string> = {
  signedUpAt: 'Signed up',
  whatsappOptIn: 'WhatsApp opt-in',
  waitlistSource: 'Signup source',
  invitedAt: 'Invited at',
  trialStartedAt: 'Trial started',
  linkedin: 'LinkedIn',
}

function customFieldLabel(key: string): string {
  return CUSTOM_FIELD_LABELS[key] ?? key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, letter => letter.toUpperCase())
}

function customFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') {
    if (/(?:At|Date)$/.test(key) && !Number.isNaN(Date.parse(value))) return formatDateTime(value)
    if (['yes', 'no'].includes(value.toLowerCase())) return enumLabel(value)
    if (key === 'waitlistSource') return enumLabel(value)
    return value
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

const PIPELINE_TABS = [
  { value: 'all', label: 'All leads' },
  { value: 'active', label: 'Active pipeline' },
  { value: 'converted', label: 'Converted' },
  { value: 'closed', label: 'Closed / lost' },
] as const

export default function LeadsPage() {
  const [tab, setTab] = React.useState<string>('all')
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [source, setSource] = React.useState('all')
  const [page, setPage] = React.useState(1)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [createPending, setCreatePending] = React.useState(false)
  const [createError, setCreateError] = React.useState('')
  const canUpdate = useHasPermission('leads.update')
  const canCreate = useHasPermission('leads.create')
  const canLogActivity = useHasPermission('activities.create')
  const canManageBilling = useHasPermission('billing.manage')
  const invalidate = useInvalidate()
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])
  const leadsQuery = useQuery({
    queryKey: ['leads', 'pipeline', { page, search, source }],
    queryFn: () => api.get<LeadListResponse>('/api/leads', {
      page,
      pageSize: 100,
      search,
      source: source === 'all' ? undefined : source,
    }),
    placeholderData: keepPreviousData,
  })
  const detailsQuery = useQuery({
    queryKey: ['lead', selectedId],
    queryFn: () => api.get<LeadDetailsResponse>(`/api/leads/${selectedId}`),
    enabled: selectedId !== null,
    staleTime: 60_000,
  })

  const visibleLeads = React.useMemo(() => {
    const items = leadsQuery.data?.items ?? []
    return items.filter((lead) => {
      if (tab === 'active') return !['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(lead.lifecycleStage)
      if (tab === 'converted') return lead.lifecycleStage === 'CONVERTED'
      if (tab === 'closed') return ['LOST', 'DISQUALIFIED'].includes(lead.lifecycleStage)
      return true
    })
  }, [leadsQuery.data?.items, tab])
  const sources = leadSource.options
  const allCount = leadsQuery.data?.total ?? 0
  const countByStage = React.useMemo(
    () => new Map((leadsQuery.data?.stageCounts ?? []).map(({ stage, count }) => [stage, count])),
    [leadsQuery.data?.stageCounts]
  )
  const countForTab = React.useCallback(
    (value: string) => {
      if (value === 'all') return allCount
      if (value === 'active') return LEAD_STAGES.filter((stage) => !['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(stage)).reduce((count, stage) => count + (countByStage.get(stage) ?? 0), 0)
      if (value === 'converted') return countByStage.get('CONVERTED') ?? 0
      return (countByStage.get('LOST') ?? 0) + (countByStage.get('DISQUALIFIED') ?? 0)
    },
    [allCount, countByStage]
  )

  async function updateStage(leadId: string, lifecycleStage: LeadStage) {
    if (lifecycleStage === 'LOST') {
      const lead = leadsQuery.data?.items.find((item) => item.id === leadId)
      if (!window.confirm(`Mark ${lead?.fullName ?? 'this lead'} as dead? This closes it as lost and records the change in its activity history.`)) return
    }
    try {
      await api.patch(`/api/leads/${leadId}`, { lifecycleStage: lifecycleStage.toLowerCase() })
      toast.success(DEMO_MODE ? 'Lead stage saved in this browser' : 'Lead stage updated')
      invalidate(['leads'])
      invalidate(['lead', leadId])
      invalidate(['reports', 'overview'])
    } catch (error) {
      toast.error(errorMessage(error))
      if (error instanceof ApiError && error.status === 403) invalidate(['session'])
    }
  }

  async function createLead(values: Record<string, unknown>) {
    setCreatePending(true)
    setCreateError('')
    try {
      await api.post('/api/leads', values)
      toast.success(DEMO_MODE ? 'Lead saved in this browser' : 'Lead created')
      setCreateOpen(false)
      invalidate(['leads'], ['reports', 'overview'])
    } catch (error) {
      setCreateError(errorMessage(error))
    } finally {
      setCreatePending(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description="Track every conversation from first enquiry through conversion."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void leadsQuery.refetch()} disabled={leadsQuery.isFetching}>
              <RefreshCw className={cn('size-4', leadsQuery.isFetching && 'animate-spin')} />
              Refresh
            </Button>
            <Button size="sm" disabled={!canCreate} onClick={() => setCreateOpen(true)} title={canCreate ? undefined : 'You do not have permission to create leads'}>
              <Plus className="size-4" />
              New lead
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-auto">
            {PIPELINE_TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value} className="gap-2">
                {item.label}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">{countForTab(item.value)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0 flex-1 sm:w-64">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search leads…" className="pl-9" />
            <span className="sr-only">Search leads</span>
          </label>
          <label>
            <span className="sr-only">Filter by lead source</span>
            <select
              value={source}
              onChange={(event) => { setSource(event.target.value); setPage(1) }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-44"
            >
              <option value="all">All sources</option>
              {sources.map((item) => <option key={item} value={item}>{enumLabel(item)}</option>)}
            </select>
          </label>
        </div>
      </div>

      {leadsQuery.isError && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="Could not load leads"
              description={errorMessage(leadsQuery.error)}
              action={<Button variant="outline" size="sm" onClick={() => void leadsQuery.refetch()}>Retry</Button>}
            />
          </CardContent>
        </Card>
      )}

      {leadsQuery.isPending && (
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-[420px] min-w-72 flex-1" />
          ))}
        </div>
      )}

      {leadsQuery.data && visibleLeads.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title={search || source !== 'all' ? 'No matching leads' : 'No leads in this view'}
              description={search || source !== 'all' ? 'Try another search or source filter.' : 'Create a lead to start building your pipeline.'}
            />
          </CardContent>
        </Card>
      )}

      {leadsQuery.data && visibleLeads.length > 0 && (
        <div className="flex items-start gap-3 overflow-x-auto pb-4">
          {LEAD_STAGES.filter((stage) => {
            if (tab === 'active') return !['CONVERTED', 'LOST', 'DISQUALIFIED'].includes(stage)
            if (tab === 'converted') return stage === 'CONVERTED'
            if (tab === 'closed') return stage === 'LOST' || stage === 'DISQUALIFIED'
            return true
          }).map((stage) => {
            const stageLeads = visibleLeads.filter((lead) => lead.lifecycleStage === stage)
            const stageCount = countByStage.get(stage) ?? 0
            return (
              <section key={stage} aria-label={`${enumLabel(stage)} leads`} className="w-[min(84vw,300px)] shrink-0">
                <header className="mb-3 flex items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('size-2 shrink-0 rounded-full', stageColor(stage))} />
                    <h2 className="truncate text-sm font-semibold">{enumLabel(stage)}</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{stageCount}</span>
                  </div>
                  <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" />
                </header>
                <div className="min-h-40 space-y-2 rounded-xl bg-muted/30 p-2">
                    {stageLeads.length === 0 ? (
                    <p className="px-2 py-4 text-xs text-muted-foreground">No leads in this stage.</p>
                  ) : (
                    stageLeads.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        canUpdate={canUpdate}
                        onOpen={() => setSelectedId(lead.id)}
                        onStageChange={(newStage) => void updateStage(lead.id, newStage)}
                      />
                    ))
                  )}
                  {stageCount > stageLeads.length && (
                    <p className="px-2 py-2 text-center text-xs text-muted-foreground">
                      {stageLeads.length} shown on this page · {stageCount} total
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {leadsQuery.data && leadsQuery.data.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border/70 pt-3">
          <p className="text-sm text-muted-foreground">
            Page {leadsQuery.data.page} of {leadsQuery.data.totalPages} · {formatNumber(leadsQuery.data.total)} leads
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || leadsQuery.isFetching}>
              <ArrowLeft className="size-4" />
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(leadsQuery.data?.totalPages ?? current, current + 1))} disabled={page >= leadsQuery.data.totalPages || leadsQuery.isFetching}>
              Next
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <LeadDetailsSheet
        lead={detailsQuery.data?.lead ?? null}
        activities={detailsQuery.data?.activities ?? []}
        loading={detailsQuery.isFetching}
        error={detailsQuery.isError ? errorMessage(detailsQuery.error) : null}
        open={selectedId !== null}
        canUpdate={canUpdate}
        canLogActivity={canLogActivity}
        canManageBilling={canManageBilling}
        onOpenChange={(open) => { if (!open) setSelectedId(null) }}
        onStageChange={(stage) => selectedId && void updateStage(selectedId, stage)}
      />

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreateError('') }}>
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New lead</DialogTitle>
            <DialogDescription>Add a prospect to the sales pipeline.</DialogDescription>
          </DialogHeader>
          <SchemaForm
            specs={createFields}
            schema={leadCreateSchema}
            submitLabel="Create lead"
            pending={createPending}
            formError={createError}
            onSubmit={createLead}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LeadCard({
  lead,
  canUpdate,
  onOpen,
  onStageChange,
}: {
  lead: LeadSummary
  canUpdate: boolean
  onOpen: () => void
  onStageChange: (stage: LeadStage) => void
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="cursor-pointer border-border/70 bg-card transition hover:border-primary/40 hover:shadow-md"
    >
      <CardContent className="space-y-3 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{lead.fullName}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{lead.organisationName || lead.leadNumber}</p>
          </div>
          <Badge variant={lead.leadScore >= 70 ? 'success' : lead.leadScore >= 40 ? 'warning' : 'secondary'} className="shrink-0">
            {lead.leadScore}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="font-normal">{enumLabel(lead.leadSource)}</Badge>
          {lead.city && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin className="size-3" />{lead.city}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs">
          <div className="min-w-0">
            <p className="truncate text-muted-foreground">{lead.assignedTo?.fullName || 'Unassigned'}</p>
            <p className="mt-1 truncate text-muted-foreground">
              {lead.lastContactedAt ? `Last contact · ${formatRelative(lead.lastContactedAt)}` : 'No interaction yet'}
            </p>
            <p className={cn('mt-1 truncate', lead.nextFollowUpAt && isOverdue(lead.nextFollowUpAt) ? 'text-destructive' : 'text-muted-foreground')}>
              {lead.nextFollowUpAt ? `Next task · ${formatRelative(lead.nextFollowUpAt)}` : 'No follow-up set'}
            </p>
          </div>
          {canUpdate && (
            <select
              aria-label={`Change stage for ${lead.fullName}`}
              value={lead.lifecycleStage}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                event.stopPropagation()
                onStageChange(event.target.value as LeadStage)
              }}
              className="max-w-28 rounded-md border border-input bg-background px-2 py-1 text-[11px]"
            >
              {LEAD_STAGES.filter((stage) => stage !== 'CONVERTED' || stage === lead.lifecycleStage).map((stage) => <option key={stage} value={stage}>{enumLabel(stage)}</option>)}
            </select>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function LeadDetailsSheet({
  lead,
  activities,
  loading,
  error,
  open,
  canUpdate,
  canLogActivity,
  canManageBilling,
  onOpenChange,
  onStageChange,
}: {
  lead: LeadDetails | null
  activities: LeadActivity[]
  loading: boolean
  error: string | null
  open: boolean
  canUpdate: boolean
  canLogActivity: boolean
  canManageBilling: boolean
  onOpenChange: (open: boolean) => void
  onStageChange: (stage: LeadStage) => void
}) {
  const [followUpDate, setFollowUpDate] = React.useState('')
  const [savingFollowUp, setSavingFollowUp] = React.useState(false)
  const [interactionOpen, setInteractionOpen] = React.useState(false)
  const [interactionType, setInteractionType] = React.useState('call')
  const [interactionStatus, setInteractionStatus] = React.useState('completed')
  const [interactionSubject, setInteractionSubject] = React.useState('')
  const [interactionNotes, setInteractionNotes] = React.useState('')
  const [interactionOutcome, setInteractionOutcome] = React.useState('')
  const [interactionDate, setInteractionDate] = React.useState('')
  const [interactionPending, setInteractionPending] = React.useState(false)
  const [activationPending, setActivationPending] = React.useState(false)
  const invalidate = useInvalidate()
  const plannedMeeting = interactionType === 'meeting' && interactionStatus === 'planned'

  React.useEffect(() => {
    setFollowUpDate(lead?.nextFollowUpAt ? toLocalDateTime(lead.nextFollowUpAt) : '')
  }, [lead?.id, lead?.nextFollowUpAt])

  async function saveFollowUp() {
    if (!lead || !followUpDate) return
    const parsedDate = new Date(followUpDate)
    if (Number.isNaN(parsedDate.getTime())) {
      toast.error('Choose a valid follow-up date and time')
      return
    }
    setSavingFollowUp(true)
    try {
      await api.patch(`/api/leads/${lead.id}`, { nextFollowUpAt: parsedDate.toISOString() })
      toast.success(DEMO_MODE ? 'Follow-up saved in this browser' : 'Follow-up scheduled')
      invalidate(['lead', lead.id])
      invalidate(['leads'])
      invalidate(['reports', 'overview'])
    } catch (saveError) {
      toast.error(errorMessage(saveError))
    } finally {
      setSavingFollowUp(false)
    }
  }

  async function saveInteraction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!lead) return

    if (plannedMeeting && !interactionDate) {
      toast.error('Choose the date and time for the scheduled meeting')
      return
    }

    const dueAt = interactionDate ? new Date(interactionDate) : null
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      toast.error('Choose a valid interaction date and time')
      return
    }

    const subject = interactionSubject.trim() || `${enumLabel(interactionType)} with ${lead.fullName}`
    let calendarLink: string | undefined
    try {
      if (plannedMeeting && dueAt) {
        calendarLink = createGoogleCalendarLink({
          title: subject,
          startAt: dueAt,
          description: interactionNotes.trim() || `Meeting with ${lead.fullName}`,
          attendeeEmail: lead.email,
        })
      }
    } catch (error) {
      toast.error(errorMessage(error))
      return
    }

    setInteractionPending(true)
    try {
      await api.post('/api/activities', {
        activityType: interactionType,
        subject,
        description: interactionNotes.trim() || undefined,
        outcome: interactionOutcome.trim() || undefined,
        status: interactionStatus,
        dueAt: dueAt?.toISOString(),
        completedAt: interactionStatus === 'completed' ? new Date().toISOString() : undefined,
        relatedLeadId: lead.id,
        externalReference: calendarLink,
        visibility: 'team',
      })
      toast.success(DEMO_MODE ? 'Interaction saved in this browser' : 'Interaction saved')
      setInteractionOpen(false)
      setInteractionSubject('')
      setInteractionNotes('')
      setInteractionOutcome('')
      setInteractionDate('')
      setInteractionType('call')
      setInteractionStatus('completed')
      invalidate(['lead', lead.id])
      invalidate(['leads'])
      invalidate(['activities'])
    } catch (saveError) {
      toast.error(errorMessage(saveError))
    } finally {
      setInteractionPending(false)
    }
  }

  async function markSubscriptionActive() {
    const subscription = lead?.convertedAccount?.subscriptions[0]
    if (!subscription || !['TRIAL', 'PAST_DUE'].includes(subscription.status)) return
    if (!window.confirm('Manually mark this subscription active? This does not verify or record a payment.')) return
    setActivationPending(true)
    try {
      await api.patch(`/api/billing/subscriptions/${subscription.id}`, { confirmManualActivation: true })
      toast.success('Subscription marked active manually')
      invalidate(['lead', lead.id])
      invalidate(['billing'])
      invalidate(['reports', 'overview'])
    } catch (activationError) {
      toast.error(errorMessage(activationError))
    } finally {
      setActivationPending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl">
        {loading && !lead ? (
          <div className="space-y-4 p-6"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-36 w-full" /><Skeleton className="h-48 w-full" /></div>
        ) : error ? (
          <div className="p-6"><EmptyState title="Could not load lead" description={error} /></div>
        ) : lead ? (
          <>
            <SheetHeader className="border-b border-border/70 bg-muted/20 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="text-xl">{lead.fullName}</SheetTitle>
                <Badge variant="outline">{enumLabel(lead.lifecycleStage)}</Badge>
              </div>
              <SheetDescription>{lead.organisationName || lead.leadNumber} · Added {formatDate(lead.createdAt)}</SheetDescription>
              <div className="flex flex-wrap gap-2 pt-2">
                <Badge variant={lead.leadScore >= 70 ? 'success' : lead.leadScore >= 40 ? 'warning' : 'secondary'}>Score {lead.leadScore}</Badge>
                <Badge variant="outline">{enumLabel(lead.leadSource)}</Badge>
                {lead.assignedTo && <Badge variant="secondary"><UserRound className="mr-1 size-3" />{lead.assignedTo.fullName}</Badge>}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              <section className="rounded-xl border border-border/70 p-4">
                <SectionTitle icon={CalendarClock} title="Next follow-up" />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="datetime-local"
                    value={followUpDate}
                    onChange={(event) => setFollowUpDate(event.target.value)}
                    disabled={!canUpdate || savingFollowUp}
                    aria-label="Next follow-up date and time"
                  />
                  <Button onClick={() => void saveFollowUp()} disabled={!canUpdate || !followUpDate || savingFollowUp}>
                    <Check className="size-4" />
                    {savingFollowUp ? 'Saving…' : 'Set date'}
                  </Button>
                </div>
                {!canUpdate && <p className="mt-2 text-xs text-muted-foreground">You do not have permission to change follow-up dates.</p>}
                {lead.lastContactedAt && <p className="mt-2 text-xs text-muted-foreground">Last contacted {formatRelative(lead.lastContactedAt)}</p>}
              </section>

              <section className="rounded-xl border border-border/70 p-4">
                <SectionTitle icon={Phone} title="Contact information" />
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <ContactLink icon={Phone} label="Phone" value={lead.phoneNumber} href={lead.phoneNumber ? `tel:${lead.phoneNumber}` : undefined} />
                  <ContactLink icon={Phone} label="Alternate phone" value={lead.alternatePhone} href={lead.alternatePhone ? `tel:${lead.alternatePhone}` : undefined} />
                  <ContactLink icon={MessageCircle} label="WhatsApp" value={lead.whatsappNumber} href={lead.whatsappNumber ? `https://wa.me/${lead.whatsappNumber.replace(/\D/g, '')}` : undefined} />
                  <ContactLink icon={Mail} label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
                  <ContactLink icon={ArrowUpRight} label="Website" value={lead.website} href={lead.website ? safeExternalUrl(lead.website) : undefined} />
                  {(lead.city || lead.state || lead.country) && <ContactLink icon={MapPin} label="Location" value={[lead.city, lead.state, lead.country].filter(Boolean).join(', ')} />}
                </div>
                {lead.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Lead tags">
                    {lead.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border/70 p-4">
                <SectionTitle icon={UserRound} title="Lead details" />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {lead.jobTitle && <KeyValue label="Job title" value={lead.jobTitle} />}
                  {lead.preferredContactMethod && <KeyValue label="Preferred contact" value={enumLabel(lead.preferredContactMethod)} />}
                  {lead.sourceDetail && <KeyValue label="Source details" value={lead.sourceDetail} />}
                  {lead.qualificationStatus && <KeyValue label="Qualification" value={enumLabel(lead.qualificationStatus)} />}
                  {lead.estimatedPracticeSize && <KeyValue label="Practice size" value={lead.estimatedPracticeSize} />}
                  {lead.estimatedUsers !== undefined && lead.estimatedUsers !== null && <KeyValue label="Expected users" value={formatNumber(lead.estimatedUsers)} />}
                  {lead.currentSoftware && <KeyValue label="Current software" value={lead.currentSoftware} />}
                  {lead.budgetRange && <KeyValue label="Budget range" value={lead.budgetRange} />}
                  {lead.expectedTimeline && <KeyValue label="Expected timeline" value={lead.expectedTimeline} />}
                  {lead.consentStatus && <KeyValue label="Consent status" value={enumLabel(lead.consentStatus)} />}
                  {lead.consentSource && <KeyValue label="Consent source" value={lead.consentSource} />}
                </div>
                {lead.painPoints && <DetailText label="Pain points" value={lead.painPoints} />}
                {lead.useCase && <DetailText label="Use case" value={lead.useCase} />}
                {lead.customFields && Object.keys(lead.customFields).length > 0 && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {Object.entries(lead.customFields).map(([key, value]) => (
                      <KeyValue key={key} label={customFieldLabel(key)} value={customFieldValue(key, value)} />
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle icon={Clock3} title="Interaction history" />
                  <Button size="sm" onClick={() => setInteractionOpen(true)} disabled={!canLogActivity}>
                    <Plus className="size-4" />
                    Log interaction
                  </Button>
                </div>
                <div className="mt-3 space-y-3">
                  {activities.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                  ) : activities.map((activity) => (
                    <div key={activity.id} className="flex gap-3">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/80" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{activity.subject}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{enumLabel(activity.activityType)} · {formatDateTime(activity.createdAt)}</p>
                        {activity.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{activity.description}</p>}
                        {activity.outcome && <p className="mt-1 text-sm"><span className="font-medium">Outcome:</span> {activity.outcome}</p>}
                        {activity.externalReference && safeExternalUrl(activity.externalReference) && (
                          <a
                            href={safeExternalUrl(activity.externalReference)}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            <ExternalLink className="size-3.5" />
                            Open calendar invitation draft
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {lead.convertedAccount && (
                <>
                  <section className="rounded-xl border border-border/70 p-4">
                    <SectionTitle icon={CircleDollarSign} title="Payment collection" />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{lead.convertedAccount.accountName}</p>
                        <p className="text-xs text-muted-foreground">{lead.convertedAccount.paymentStatus || 'Payment status not set'}</p>
                      </div>
                      {lead.convertedAccount.subscriptions[0] && (
                        <Badge variant={lead.convertedAccount.subscriptions[0].status === 'ACTIVE' ? 'success' : 'warning'}>
                          {enumLabel(lead.convertedAccount.subscriptions[0].status)}
                        </Badge>
                      )}
                    </div>
                    {canManageBilling && lead.convertedAccount.subscriptions[0] &&
                      ['TRIAL', 'PAST_DUE'].includes(lead.convertedAccount.subscriptions[0].status) && (
                        <div className="mt-3">
                          <Button size="sm" onClick={() => void markSubscriptionActive()} disabled={activationPending}>
                            {activationPending ? 'Saving…' : 'Mark active (manual)'}
                          </Button>
                          <p className="mt-1 text-xs text-muted-foreground">Changes the CRM subscription status only; it does not verify or record a payment.</p>
                        </div>
                      )}
                    {lead.convertedAccount.subscriptions[0] && (
                      <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-xs">
                        <KeyValue label="Subscription started" value={formatDate(lead.convertedAccount.subscriptions[0].startDate)} />
                        <KeyValue label="Next renewal" value={formatDate(lead.convertedAccount.subscriptions[0].renewalDate)} />
                        <KeyValue label="Plan amount" value={formatCurrency(lead.convertedAccount.subscriptions[0].amount)} />
                        <KeyValue label="Account MRR" value={formatCurrency(lead.convertedAccount.mrr)} />
                      </div>
                    )}
                    <div className="mt-3 space-y-2">
                      {lead.convertedAccount.invoices.map((invoice) => {
                        const payment = invoice.payments[0]
                        return (
                          <div key={invoice.invoiceNumber} className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-xs">
                            <div>
                              <p className="font-medium">{invoice.invoiceNumber} · {enumLabel(invoice.status)}</p>
                              <p className="text-muted-foreground">{payment?.paidAt ? `Paid ${formatDate(payment.paidAt)}` : `Due ${formatDate(invoice.dueDate)}`}</p>
                            </div>
                            <p className="shrink-0 tabular-nums">{formatCurrency(invoice.amountPaid)} / {formatCurrency(invoice.total)}</p>
                          </div>
                        )
                      })}
                      {!lead.convertedAccount.invoices.length && !lead.convertedAccount.subscriptions.length && (
                        <p className="text-xs text-muted-foreground">No subscription or invoice records have been added.</p>
                      )}
                    </div>
                  </section>

                  {lead.convertedAccount.onboardingProjects[0] && (
                    <section className="rounded-xl border border-border/70 p-4">
                      <SectionTitle icon={CalendarClock} title="Onboarding" />
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{enumLabel(lead.convertedAccount.onboardingProjects[0].status)}</p>
                          <p className="text-xs text-muted-foreground">Target go-live {formatDate(lead.convertedAccount.onboardingProjects[0].targetGoLiveDate)}</p>
                        </div>
                        <Badge variant="secondary">{lead.convertedAccount.onboardingProjects[0].progressPercentage}%</Badge>
                      </div>
                    </section>
                  )}
                </>
              )}

              {canUpdate && (
                <section className="rounded-xl border border-border/70 p-4">
                  <SectionTitle icon={ChevronDown} title="Move through pipeline" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    {LEAD_STAGES.filter((stage) => stage !== lead.lifecycleStage && stage !== 'CONVERTED').map((stage) => (
                      <Button key={stage} variant="outline" size="sm" onClick={() => onStageChange(stage)}>
                        Move to {enumLabel(stage)}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Lead conversion is handled through the Convert action so its account, contact and opportunity records are created together.</p>
                </section>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
      <Dialog open={interactionOpen} onOpenChange={setInteractionOpen}>
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Log interaction with {lead?.fullName ?? 'lead'}</DialogTitle>
            <DialogDescription>
              Choose a type and save. Add notes or a next step only when useful.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void saveInteraction(event)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>Type</span>
                <select
                  value={interactionType}
                  onChange={(event) => setInteractionType(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3"
                  disabled={!canLogActivity || interactionPending}
                >
                  {['call', 'email', 'whatsapp', 'meeting', 'demo', 'note', 'task', 'visit'].map((type) => (
                    <option key={type} value={type}>{enumLabel(type)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Status</span>
                <select
                  value={interactionStatus}
                  onChange={(event) => setInteractionStatus(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3"
                  disabled={!canLogActivity || interactionPending}
                >
                  <option value="completed">Completed</option>
                  <option value="planned">Scheduled / planned</option>
                  <option value="no_show">No show</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span>Subject (optional)</span>
              <Input
                value={interactionSubject}
                onChange={(event) => setInteractionSubject(event.target.value)}
                placeholder={`${enumLabel(interactionType)} with ${lead?.fullName ?? 'lead'}`}
                maxLength={255}
                disabled={interactionPending}
              />
            </label>
            {interactionStatus === 'planned' && (
              <label className="block space-y-1 text-sm">
                <span>{plannedMeeting ? 'Meeting date and time' : 'Schedule date and time (optional)'}</span>
                <Input type="datetime-local" value={interactionDate} onChange={(event) => setInteractionDate(event.target.value)} required={plannedMeeting} disabled={interactionPending} />
              </label>
            )}
            <label className="block space-y-1 text-sm">
              <span>Notes</span>
              <Textarea value={interactionNotes} onChange={(event) => setInteractionNotes(event.target.value)} placeholder="Quick summary (optional)" maxLength={5000} disabled={interactionPending} />
            </label>
            <details className="rounded-md border border-border/70 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">More details (optional)</summary>
              <div className="mt-3 space-y-4">
                {interactionStatus !== 'planned' && (
                  <label className="block space-y-1">
                    <span>Date and time</span>
                    <Input type="datetime-local" value={interactionDate} onChange={(event) => setInteractionDate(event.target.value)} disabled={interactionPending} />
                  </label>
                )}
                <label className="block space-y-1">
                  <span>Outcome / next step</span>
                  <Input value={interactionOutcome} onChange={(event) => setInteractionOutcome(event.target.value)} maxLength={255} placeholder="e.g. Follow up next week" disabled={interactionPending} />
                </label>
              </div>
            </details>
            {interactionType === 'meeting' && interactionStatus === 'planned' && (
              <p className="text-xs text-muted-foreground">The Calendar link prepares an event and adds the lead’s email when available. It does not create a Meet room or send an invitation automatically.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setInteractionOpen(false)} disabled={interactionPending}>Cancel</Button>
              <Button type="submit" disabled={!canLogActivity || interactionPending}>
                {interactionPending ? 'Saving…' : 'Save interaction'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Clock3; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="size-4" />
      {title}
    </h3>
  )
}

function ContactLink({ icon: Icon, label, value, href }: { icon: typeof Phone; label: string; value?: string | null; href?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/30 p-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        {value ? (
          href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noreferrer' : undefined} className="break-all text-sm hover:underline">{value}</a>
            : <p className="break-all text-sm">{value}</p>
        ) : <p className="text-sm text-muted-foreground">Not added</p>}
      </div>
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  )
}

function DetailText({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-lg bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{value}</p>
    </div>
  )
}

function stageColor(stage: LeadStage) {
  if (stage === 'CONVERTED') return 'bg-emerald-500'
  if (stage === 'LOST') return 'bg-rose-500'
  if (stage === 'NEGOTIATION' || stage === 'PROPOSAL_SENT') return 'bg-amber-500'
  if (stage === 'DEMO_BOOKED' || stage === 'QUALIFIED') return 'bg-violet-500'
  if (stage === 'CONTACTED') return 'bg-sky-500'
  return 'bg-muted-foreground'
}

function toLocalDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function safeExternalUrl(value: string) {
  try {
    const normalized = value.startsWith('http://') || value.startsWith('https://') ? value : `https://${value}`
    const url = new URL(normalized)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}
