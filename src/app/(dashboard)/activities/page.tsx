'use client'

import * as React from 'react'
import Link from 'next/link'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  CalendarClock, CheckSquare, FileText, Mail, MapPin, MessageCircle, Phone, PlayCircle, RefreshCw, Search, Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { api } from '@/lib/client/api'
import { errorMessage } from '@/lib/client/hooks'
import { enumLabel, formatDate, formatDateTime } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { activityType } from '@/lib/validations/crm'
import { stageTitle } from '@/lib/leads/stages'
import { stageColor } from '../leads/lead-panels'

interface ActivityItem {
  id: string
  activityType: string
  subject: string
  status: string
  description: string | null
  outcome: string | null
  externalReference: string | null
  dueAt: string | null
  createdAt: string
  owner: { id: string; fullName: string } | null
  assignedTo: { id: string; fullName: string } | null
  relatedLead: { id: string; fullName: string; leadNumber: string; lifecycleStage: string } | null
}
interface ActivityPage { items: ActivityItem[]; total: number; page: number; totalPages: number }
interface Actor { id: string; name: string; count: number }

const PAGE_SIZE = 50
const RANGES = [
  { value: 'all', label: 'All time', days: null },
  { value: 'today', label: 'Today', days: 0 },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
] as const

const TYPE_ICON: Record<string, typeof Phone> = {
  CALL: Phone, EMAIL: Mail, MEETING: Users, DEMO: PlayCircle, NOTE: FileText, TASK: CheckSquare,
  VISIT: MapPin, WHATSAPP: MessageCircle,
}

function sinceIso(range: string): string | undefined {
  const option = RANGES.find((r) => r.value === range)
  if (!option || option.days === null) return undefined
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - option.days)
  return d.toISOString()
}

/** Every activity, newest first, with the lead it belongs to and who did it. */
export default function ActivitiesPage() {
  const [doneBy, setDoneBy] = React.useState('all')
  const [type, setType] = React.useState('all')
  const [range, setRange] = React.useState('all')
  const [leadsOnly, setLeadsOnly] = React.useState(false)
  const [searchInput, setSearchInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const actors = useQuery({ queryKey: ['activities', 'actors'], queryFn: () => api.get<Actor[]>('/api/activities/actors') })
  const filters = { doneBy, type, range, leadsOnly, search }
  const feed = useInfiniteQuery({
    queryKey: ['activities', 'feed', filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<ActivityPage>('/api/activities', {
      page: pageParam,
      pageSize: PAGE_SIZE,
      sortBy: 'createdAt',
      sort: 'desc',
      doneByUserId: doneBy === 'all' ? undefined : doneBy,
      activityType: type === 'all' ? undefined : type,
      createdAfter: sinceIso(range),
      leadsOnly: leadsOnly ? 'true' : undefined,
      search: search || undefined,
    }),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    placeholderData: keepPreviousData,
  })
  const items = React.useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data])
  const total = feed.data?.pages[0]?.total ?? 0

  // Group by day so the feed reads top to bottom like a diary.
  const days = React.useMemo(() => {
    const groups: { day: string; items: ActivityItem[] }[] = []
    for (const item of items) {
      const day = formatDate(item.createdAt)
      const last = groups[groups.length - 1]
      if (last?.day === day) last.items.push(item)
      else groups.push({ day, items: [item] })
    }
    return groups
  }, [items])

  const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activities"
        description="Everything the team did, newest first: which lead, who did it, and what happened."
        actions={
          <Button variant="outline" size="sm" onClick={() => void feed.refetch()} disabled={feed.isFetching}>
            <RefreshCw className={cn('size-4', feed.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by lead name, subject or notes…" className="pl-9" aria-label="Search activities" />
        </label>
        <select aria-label="Done by" value={doneBy} onChange={(e) => setDoneBy(e.target.value)} className={selectClass}>
          <option value="all">Everyone</option>
          {(actors.data ?? []).map((actor) => <option key={actor.id} value={actor.id}>{actor.name} ({actor.count})</option>)}
        </select>
        <select aria-label="Activity type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
          <option value="all">All types</option>
          {activityType.options.map((t) => <option key={t} value={t}>{enumLabel(t)}</option>)}
        </select>
        <select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value)} className={selectClass}>
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={leadsOnly} onChange={(e) => setLeadsOnly(e.target.checked)} />
          Only lead activities
        </label>
      </div>

      {feed.data && (
        <p className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'activity' : 'activities'}{doneBy !== 'all' && actors.data ? ` by ${actors.data.find((a) => a.id === doneBy)?.name ?? 'this member'}` : ''}
        </p>
      )}

      {feed.isError && (
        <Card><CardContent className="py-12"><EmptyState title="Could not load activities" description={errorMessage(feed.error)} /></CardContent></Card>
      )}
      {feed.isPending && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>}
      {feed.data && items.length === 0 && (
        <Card><CardContent className="py-12"><EmptyState title="No activities" description="Try another person, type or time range." /></CardContent></Card>
      )}

      <div className="space-y-6">
        {days.map((group) => (
          <section key={group.day} aria-label={group.day}>
            <h2 className="sticky top-0 z-10 mb-2 bg-background/95 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              {group.day}
            </h2>
            <ol className="space-y-2 border-l border-border/70 pl-4">
              {group.items.map((item) => <ActivityEntry key={item.id} item={item} />)}
            </ol>
          </section>
        ))}
      </div>

      {feed.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? 'Loading…' : `Load more (${items.length} of ${total})`}
          </Button>
        </div>
      )}
    </div>
  )
}

function ActivityEntry({ item }: { item: ActivityItem }) {
  const Icon = TYPE_ICON[item.activityType] ?? CalendarClock
  const who = item.owner?.fullName ?? item.assignedTo?.fullName ?? 'System'
  const lead = item.relatedLead
  return (
    <li className="relative">
      <span className="absolute -left-[1.4rem] top-3 size-2.5 rounded-full border-2 border-background bg-primary" />
      <div className="rounded-xl border border-border/70 bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 rounded-md bg-muted p-1.5"><Icon aria-hidden="true" className="size-3.5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{item.subject}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{who}</span> · {enumLabel(item.activityType)} · {formatDateTime(item.createdAt)}
                {item.status && item.status !== 'COMPLETED' && <> · {enumLabel(item.status)}</>}
              </p>
            </div>
          </div>
          {lead && (
            <Link href={`/leads?lead=${lead.id}`} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-xs hover:border-primary/50">
              <span className={cn('size-2 rounded-full', stageColor(lead.lifecycleStage))} />
              <span className="max-w-[10rem] truncate font-medium">{lead.fullName}</span>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">{stageTitle(lead.lifecycleStage)}</Badge>
            </Link>
          )}
        </div>
        {item.description && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.description}</p>}
        {item.outcome && <p className="mt-1 text-sm"><span className="font-medium">Outcome:</span> {item.outcome}</p>}
        {item.dueAt && item.status === 'PLANNED' && <p className="mt-1 text-xs text-muted-foreground">Scheduled for {formatDateTime(item.dueAt)}</p>}
      </div>
    </li>
  )
}
