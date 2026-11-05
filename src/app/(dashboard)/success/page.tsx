'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDate } from '@/lib/client/format'
import {
  successPlanCreateSchema,
  successPlanUpdateSchema,
} from '@/lib/validations/admin'

interface SuccessPlanRow {
  id: string
  objective: string
  metricName: string | null
  targetValue: string | number | null
  currentValue: string | number | null
  status: string | null
  progressPercentage: number
  nextReviewDate: string | null
  account: { id: string; accountName: string; healthStatus: string | null } | null
  owner: { id: string; fullName: string } | null
}

const columns: Column<SuccessPlanRow>[] = [
  {
    key: 'objective',
    header: 'Success plan',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.objective}</div>
        <div className="text-xs text-muted-foreground">{row.account?.accountName ?? ''}</div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  {
    key: 'health',
    header: 'Account health',
    hideOnMobile: true,
    cell: (row) => <StatusBadge value={row.account?.healthStatus} />,
  },
  {
    key: 'metric',
    header: 'Metric',
    hideOnMobile: true,
    cell: (row) => (row.metricName ? `${row.currentValue ?? '—'} / ${row.targetValue ?? '—'}` : '—'),
  },
  {
    key: 'progress',
    header: 'Progress',
    className: 'text-right',
    cell: (row) => `${row.progressPercentage ?? 0}%`,
  },
  {
    key: 'review',
    header: 'Next review',
    hideOnMobile: true,
    cell: (row) => (row.nextReviewDate ? formatDate(row.nextReviewDate) : '—'),
  },
  { key: 'owner', header: 'Owner', hideOnMobile: true, cell: (row) => row.owner?.fullName ?? 'Unassigned' },
]

const PLAN_STATUS = ['draft', 'active', 'achieved', 'cancelled']

const config: ResourceConfig<SuccessPlanRow> = {
  key: 'success',
  path: '/api/success',
  title: 'Health & retention',
  singular: 'success plan',
  description: 'Desired outcomes per account, with the metric that proves them.',
  columns,
  createPermission: 'success.manage',
  editPermission: 'success.manage',
  createSchema: successPlanCreateSchema,
  editSchema: successPlanUpdateSchema,
  rowLabel: (row) => row.objective,
  filters: [{ key: 'status', label: 'Status', options: enumFilter(PLAN_STATUS) }],
  createFields: [
    { name: 'objective', label: 'Objective', kind: 'text' },
    {
      name: 'accountId',
      label: 'Account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    {
      name: 'ownerUserId',
      label: 'Owner',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    { name: 'status', label: 'Status', kind: 'select', options: PLAN_STATUS, half: true },
    { name: 'metricName', label: 'Metric', kind: 'text', placeholder: 'Weekly sessions booked', half: true },
    { name: 'baselineValue', label: 'Baseline', kind: 'number', half: true },
    { name: 'targetValue', label: 'Target', kind: 'number', half: true },
    { name: 'currentValue', label: 'Current', kind: 'number', half: true },
    { name: 'targetDate', label: 'Target date', kind: 'datetime', half: true },
    { name: 'nextReviewDate', label: 'Next review', kind: 'datetime', half: true },
    { name: 'targetOutcome', label: 'Target outcome', kind: 'textarea' },
    { name: 'risks', label: 'Risks', kind: 'textarea' },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
  editFields: [
    { name: 'objective', label: 'Objective', kind: 'text' },
    { name: 'status', label: 'Status', kind: 'select', options: PLAN_STATUS, half: true },
    { name: 'currentValue', label: 'Current', kind: 'number', half: true },
    { name: 'progressPercentage', label: 'Progress (%)', kind: 'number', half: true },
    { name: 'nextReviewDate', label: 'Next review', kind: 'datetime', half: true },
    { name: 'risks', label: 'Risks', kind: 'textarea' },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
}

export default function SuccessPage() {
  return <ResourcePage config={config} />
}
