'use client'

import { ArrowDown, ArrowUp, ArrowUpDown, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { enumLabel, formatDate, formatRelative } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { DEAD_LEAD_STAGES, LEAD_STAGES, STAGE_INFO, isStage, stageTitle, type LeadStage } from '@/lib/leads/stages'

export type SortKey = 'firstName' | 'leadScore' | 'createdAt' | 'nextFollowUpAt'

export interface TableLead {
  id: string
  leadNumber: string
  fullName: string
  email: string | null
  phoneNumber: string | null
  city: string | null
  leadSource: string
  lifecycleStage: string
  leadScore: number
  isPriority: boolean
  createdAt: string
  nextFollowUpAt: string | null
  lastContactedAt: string | null
  assignedTo: { fullName: string } | null
  customFields?: Record<string, unknown> | null
  jobTitle?: string | null
  nextAction?: string | null
}

/** The sheet's own source text ("Hot lead - Survey", "hero"...) when there is one, else the CRM source. */
function sourceText(lead: TableLead): string {
  const raw = lead.customFields?.waitlistSource
  return typeof raw === 'string' && raw.trim() ? raw.trim() : enumLabel(lead.leadSource)
}

function SortHead({
  label, column, sortBy, sort, onSort, className,
}: {
  label: string
  column: SortKey
  sortBy: SortKey
  sort: 'asc' | 'desc'
  onSort: (column: SortKey) => void
  className?: string
}) {
  const active = sortBy === column
  const Icon = !active ? ArrowUpDown : sort === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead className={className} aria-sort={active ? (sort === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 font-medium hover:text-foreground">
        {label}
        <Icon className={cn('size-3.5', !active && 'opacity-40')} />
      </button>
    </TableHead>
  )
}

/** Compact, sortable list of leads. Paging and sorting happen on the server, so it stays fast with thousands of leads. */
export function LeadsTable({
  leads, canUpdate, sortBy, sort, onSort, onOpen, onTogglePriority, onStageChange,
}: {
  onStageChange: (lead: TableLead, stage: LeadStage) => void
  leads: TableLead[]
  canUpdate: boolean
  sortBy: SortKey
  sort: 'asc' | 'desc'
  onSort: (column: SortKey) => void
  onOpen: (id: string) => void
  onTogglePriority: (lead: TableLead) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <SortHead label="Name · role" column="firstName" sortBy={sortBy} sort={sort} onSort={onSort} />
            <TableHead className="hidden md:table-cell">Work email</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="hidden lg:table-cell">Source</TableHead>
            <TableHead className="hidden xl:table-cell">Last contact</TableHead>
            <SortHead label="Next action" column="nextFollowUpAt" sortBy={sortBy} sort={sort} onSort={onSort} className="hidden lg:table-cell" />
            <TableHead className="hidden xl:table-cell">Owner</TableHead>
            <SortHead label="Added" column="createdAt" sortBy={sortBy} sort={sort} onSort={onSort} className="hidden 2xl:table-cell" />
            <SortHead label="Score" column="leadScore" sortBy={sortBy} sort={sort} onSort={onSort} className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow
              key={lead.id}
              tabIndex={0}
              onClick={() => onOpen(lead.id)}
              onKeyDown={(event) => { if (event.key === 'Enter') onOpen(lead.id) }}
              className={cn(
                'cursor-pointer',
                lead.isPriority && 'bg-amber-50 shadow-[inset_3px_0_0_0_rgb(245_158_11)] hover:bg-amber-100/70 dark:bg-amber-500/10 dark:hover:bg-amber-500/20'
              )}
            >
              <TableCell className="w-10 pr-0">
                {canUpdate ? (
                  <button
                    type="button"
                    aria-label={lead.isPriority ? `Remove ${lead.fullName} from priority reachout` : `Mark ${lead.fullName} as priority reachout`}
                    aria-pressed={lead.isPriority}
                    title={lead.isPriority ? 'Priority reachout (click to move to Others)' : 'Mark as priority reachout'}
                    onClick={(event) => { event.stopPropagation(); onTogglePriority(lead) }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-500/20"
                  >
                    <Star className={cn('size-4', lead.isPriority ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground')} />
                  </button>
                ) : lead.isPriority ? (
                  <Star aria-label="Priority reachout" className="ml-1 size-4 fill-amber-500 text-amber-500" />
                ) : null}
              </TableCell>
              <TableCell className="max-w-[16rem]">
                <p className="truncate font-medium">{lead.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{lead.jobTitle || lead.leadNumber}</p>
              </TableCell>
              <TableCell className="hidden max-w-[16rem] md:table-cell">
                <p className="truncate text-sm">{lead.email ?? '—'}</p>
                {lead.phoneNumber && <p className="truncate text-xs text-muted-foreground">{lead.phoneNumber}</p>}
              </TableCell>
              <TableCell>
                {canUpdate ? (
                  <select
                    aria-label={`Change stage for ${lead.fullName}`}
                    title={STAGE_INFO[lead.lifecycleStage as LeadStage]?.meaning}
                    value={lead.lifecycleStage}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onChange={(event) => onStageChange(lead, event.target.value as LeadStage)}
                    className="max-w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
                  >
                    {LEAD_STAGES.map((stage) => <option key={stage} value={stage}>{stageTitle(stage)}</option>)}
                  </select>
                ) : (
                <Badge
                  variant={isStage(lead.lifecycleStage, DEAD_LEAD_STAGES) ? 'secondary' : 'outline'}
                  className="whitespace-nowrap font-normal"
                  title={STAGE_INFO[lead.lifecycleStage as LeadStage]?.meaning}
                >
                  {stageTitle(lead.lifecycleStage)}
                </Badge>
                )}
              </TableCell>
              <TableCell className="hidden max-w-[12rem] lg:table-cell">
                <span className="block truncate text-sm text-muted-foreground">{sourceText(lead)}</span>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground xl:table-cell">
                {lead.lastContactedAt ? formatRelative(lead.lastContactedAt) : '—'}
              </TableCell>
              <TableCell className="hidden max-w-[14rem] lg:table-cell">
                <p className="truncate text-sm">{lead.nextAction || '—'}</p>
                {lead.nextFollowUpAt && <p className="truncate text-xs text-muted-foreground">{formatRelative(lead.nextFollowUpAt)}</p>}
              </TableCell>
              <TableCell className="hidden max-w-[10rem] xl:table-cell">
                <span className="block truncate text-sm text-muted-foreground">{lead.assignedTo?.fullName ?? 'Unassigned'}</span>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground 2xl:table-cell">{formatDate(lead.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Badge variant={lead.leadScore >= 70 ? 'success' : lead.leadScore >= 40 ? 'warning' : 'secondary'}>{lead.leadScore}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
