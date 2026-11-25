'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { errorMessage } from '@/lib/client/hooks'
import { useOverview } from '@/lib/client/overview'
import { enumLabel, formatNumber, formatPercent } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { FUNNEL_STAGES, LEAD_STAGES, STAGE_INFO, reachedCounts, stageTitle, type LeadStage } from '@/lib/leads/stages'
import { stageColor } from '../leads/lead-panels'

const leadsHref = (stage: LeadStage) => `/leads?stage=${stage.toLowerCase()}`

/** The whole dashboard is the 8-stage pipeline: stage funnel, team × stage, lead sources. */
export default function DashboardPage() {
  const query = useOverview()
  const dashboard = query.data?.dashboard
  const pipeline = dashboard?.pipeline
  const counts = useMemo(() => new Map((pipeline?.stageCounts ?? []).map(({ stage, count }) => [stage, count])), [pipeline])
  const reached = useMemo(() => reachedCounts(counts), [counts])
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0)
  const owners = useMemo(
    () => (pipeline?.owners ?? [])
      .map((owner) => ({ ...owner, total: Object.values(owner.stages).reduce((sum, n) => sum + n, 0) }))
      .sort((a, b) => (a.userId === null ? 1 : b.userId === null ? -1 : b.total - a.total)),
    [pipeline]
  )
  const sources = (dashboard?.sales?.leadsBySource ?? []).slice().sort((a, b) => b.count - a.count)
  const maxSource = Math.max(1, ...sources.map((s) => s.count))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your leads across the 8 pipeline stages. Click a stage to work on those leads."
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
        <div className="space-y-4">
          <Skeleton className="h-56 w-full" />
          <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-64 lg:col-span-2" /><Skeleton className="h-64" /></div>
        </div>
      )}

      {dashboard && !pipeline && (
        <Card>
          <CardContent className="py-12">
            <EmptyState title="No lead access" description="Your role cannot see leads, so there is no pipeline to show." />
          </CardContent>
        </Card>
      )}

      {pipeline && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Lead pipeline</CardTitle>
              <p className="text-sm text-muted-foreground">
                {formatNumber(total)} leads. The line under each stage shows how many moved on to the next stage.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {LEAD_STAGES.map((stage) => {
                  const count = counts.get(stage) ?? 0
                  const index = FUNNEL_STAGES.indexOf(stage)
                  const next = index >= 0 && index < FUNNEL_STAGES.length - 1 ? FUNNEL_STAGES[index + 1] : null
                  const here = reached.get(stage) ?? 0
                  const moved = next ? reached.get(next) ?? 0 : 0
                  return (
                    <Link
                      key={stage}
                      href={leadsHref(stage)}
                      title={`${STAGE_INFO[stage].meaning} To do: ${STAGE_INFO[stage].todo}`}
                      className="group rounded-xl border border-border/70 bg-card p-3 transition hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <span className={cn('size-2 shrink-0 rounded-full', stageColor(stage))} />
                        <span className="truncate">{stageTitle(stage)}</span>
                      </div>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">{formatNumber(count)}</p>
                      <p className="mt-1 line-clamp-2 min-h-8 text-[11px] text-muted-foreground">{STAGE_INFO[stage].meaning}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {next
                          ? here > 0 ? `${formatPercent(Math.round((moved / here) * 100))} moved to ${STAGE_INFO[next].label}` : 'No leads yet'
                          : stage === 'LOST' ? 'Never became customers' : 'Left or paused'}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary opacity-0 transition group-hover:opacity-100">
                        Open leads <ArrowRight className="size-3" />
                      </p>
                    </Link>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle>Team by stage</CardTitle>
                <p className="text-sm text-muted-foreground">How many leads each owner has in every stage.</p>
              </CardHeader>
              <CardContent className="p-0">
                {owners.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-muted-foreground">No leads yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b border-border/70 text-xs text-muted-foreground">
                          <th className="px-4 py-2 text-left font-medium">Owner</th>
                          {LEAD_STAGES.map((stage) => (
                            <th key={stage} className="px-2 py-2 text-right font-medium" title={stageTitle(stage)}>
                              {STAGE_INFO[stage].step ?? (stage === 'NEW' ? 'New' : 'Dead')}
                            </th>
                          ))}
                          <th className="px-4 py-2 text-right font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {owners.map((owner) => (
                          <tr key={owner.userId ?? 'unassigned'} className="border-b border-border/50 last:border-0">
                            <td className={cn('max-w-[12rem] truncate px-4 py-2 font-medium', !owner.userId && 'text-muted-foreground')}>{owner.name}</td>
                            {LEAD_STAGES.map((stage) => {
                              const n = owner.stages[stage] ?? 0
                              return (
                                <td key={stage} className={cn('px-2 py-2 text-right tabular-nums', n === 0 && 'text-muted-foreground/50')}>
                                  {n || '·'}
                                </td>
                              )
                            })}
                            <td className="px-4 py-2 text-right font-semibold tabular-nums">{owner.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="px-4 py-2 text-[11px] text-muted-foreground">Columns: New, steps 1–8 (Contacted → Churned / paused), Dead.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Where leads come from</CardTitle>
                <p className="text-sm text-muted-foreground">Leads by source (dead leads not counted).</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {sources.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No leads yet.</p>
                ) : sources.map((source) => (
                  <div key={source.source} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{enumLabel(source.source)}</span>
                      <span className="tabular-nums text-muted-foreground">{formatNumber(source.count)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((source.count / maxSource) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
