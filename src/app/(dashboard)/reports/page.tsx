'use client'

import { Download, RefreshCw, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage, useHasPermission, useSession } from '@/lib/client/hooks'
import { useOverview, type OverviewDashboard } from '@/lib/client/overview'
import { enumLabel, formatCurrency, formatNumber, formatPercent } from '@/lib/client/format'

const EXPORT_ENTITIES = [
  { entity: 'leads', label: 'Leads' },
  { entity: 'contacts', label: 'Contacts' },
  { entity: 'accounts', label: 'Accounts' },
  { entity: 'opportunities', label: 'Opportunities' },
]

/** Funnel order matters for a conversion report, so the stage list is explicit. */
const LEAD_FUNNEL = ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_BOOKED', 'PROPOSAL_SENT', 'NEGOTIATION', 'CONVERTED']

type Bucket = { label: string; count: number }

function reportSections(dashboard: OverviewDashboard) {
  const sections: { title: string; description: string; buckets: Bucket[]; funnel?: boolean }[] = []

  const sales = dashboard.sales
  const leadsByStage = sales?.leadsByStage
  const leadsBySource = sales?.leadsBySource
  if (sales?.canViewLeads && leadsByStage && leadsBySource) {
    sections.push({
      title: 'Lead funnel',
      description: 'Every open lead by lifecycle stage, in funnel order.',
      buckets: LEAD_FUNNEL.map(stage => ({
        label: enumLabel(stage),
        count: leadsByStage.find(b => b.stage === stage)?.count ?? 0,
      })),
      funnel: true,
    })
    const sources = leadsBySource
      .map(b => ({ label: enumLabel(b.source), count: b.count }))
      .sort((a, b) => b.count - a.count)
    sections.push({ title: 'Leads by source', description: 'Where pipeline originates.', buckets: sources })
  }

  if (dashboard.success) {
    sections.push({
      title: 'Account health',
      description: 'Renewal risk across the book of business.',
      buckets: dashboard.success.accountsByHealth.map(b => ({ label: enumLabel(b.status), count: b.count })),
    })
  }

  if (dashboard.management) {
    sections.push({
      title: 'Customer organisations',
      description: 'AuraDeck customer base by lifecycle status.',
      buckets: dashboard.management.customersByStatus.map(b => ({ label: enumLabel(b.status), count: b.count })),
    })
  }

  return sections
}

export default function ReportsPage() {
  const query = useOverview()
  const { data: session } = useSession()
  const canExport = useHasPermission('export.manage')

  const dashboard = query.data?.dashboard
  const sales = dashboard?.sales
  const success = dashboard?.success
  const management = dashboard?.management
  const practice = dashboard?.practice

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Server-side aggregates for the records your role can reach."
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      {session && (
        <p className="text-xs text-muted-foreground">
          Reporting scope: <span className="font-medium">{enumLabel(session.scopeType ?? 'organisation')}</span>{' '}
          data as <span className="font-medium">{enumLabel(session.roleSlug ?? 'member')}</span>. Counts include only
          records visible to that scope.
        </p>
      )}

      {query.isError && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              title="Could not load reports"
              description={errorMessage(query.error)}
              icon={<RefreshCw className="size-5" />}
              action={
                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                  Retry
                </Button>
              }
            />
          </CardContent>
        </Card>
      )}

      {query.isPending && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {dashboard && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {sales?.canViewOpportunities && (
              <>
                <Metric label="Pipeline value" value={formatCurrency(sales.pipelineValue ?? 0, { compact: true })} />
                <Metric label="Weighted forecast" value={formatCurrency(sales.weightedForecast ?? 0, { compact: true })} />
                <Metric label="Open opportunities" value={formatNumber(sales.openCount ?? 0)} />
                <Metric label="Win rate" value={formatPercent(sales.winRate ?? 0)} />
              </>
            )}
            {success && (
              <>
                <Metric label="Renewals next 90 days" value={formatNumber(success.renewalsIn30 + success.renewalsIn60 + success.renewalsIn90)} />
                {success.onboardingActive !== null && (
                  <Metric label="Onboarding in flight" value={formatNumber(success.onboardingActive)} />
                )}
                <Metric label="At-risk accounts" value={formatNumber(success.atRiskAccounts)} tone={success.atRiskAccounts > 0 ? 'danger' : undefined} />
              </>
            )}
            {practice && (
              <>
                <Metric label="Active clients" value={formatNumber(practice.activeClients)} />
                <Metric label="Outstanding balance" value={formatCurrency(practice.outstandingBalance, { compact: true })} />
              </>
            )}
            {management && (
              <>
                <Metric label="Current MRR" value={formatCurrency(management.currentMrr, { compact: true })} />
                <Metric label="Open tickets" value={formatNumber(management.openTickets)} />
                <Metric label="SLA breached" value={formatNumber(management.slaBreached)} tone={management.slaBreached > 0 ? 'danger' : undefined} />
              </>
            )}
          </div>

          {reportSections(dashboard).map(section => (
            <BreakdownTable key={section.title} title={section.title} description={section.description} buckets={section.buckets} funnel={section.funnel} />
          ))}

          {success && (
            <BreakdownTable
              title="Renewal window"
              description="Accounts with a renewal date in each window."
              buckets={[
                { label: 'Next 30 days', count: success.renewalsIn30 },
                { label: '31–60 days', count: success.renewalsIn60 },
                { label: '61–90 days', count: success.renewalsIn90 },
              ]}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Data export</CardTitle>
              <CardDescription>
                CSV exports are capped per request and every download is written to the audit log.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {canExport ? (
                <div className="flex flex-wrap gap-2">
                  {EXPORT_ENTITIES.map(item => (
                    <Button key={item.entity} variant="outline" size="sm" asChild>
                      <a href={`/api/export?entity=${item.entity}`} download>
                        <Download className="size-4" />
                        {item.label}
                      </a>
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldAlert className="size-4" />
                  Exports need the <code className="rounded bg-muted px-1 py-0.5 text-xs">export.manage</code> permission.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Clients are deliberately not exportable — patient identity and health data stay inside the practice
                workspace, per the security policy.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function BreakdownTable({
  title,
  description,
  buckets,
  funnel = false,
}: {
  title: string
  description: string
  buckets: Bucket[]
  funnel?: boolean
}) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0)
  const first = buckets[0]?.count ?? 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {total === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">No records in this view yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Segment</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Share</TableHead>
                {funnel && <TableHead className="hidden text-right sm:table-cell">Step conversion</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map(bucket => (
                <TableRow key={bucket.label}>
                  <TableCell className="font-medium">{bucket.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(bucket.count)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatPercent(total === 0 ? 0 : Math.round((bucket.count / total) * 100))}
                  </TableCell>
                  {funnel && (
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                      {first === 0 || bucket.count === 0 ? '—' : formatPercent(Math.round((bucket.count / first) * 100))}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
