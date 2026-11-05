'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDate, formatDateTime } from '@/lib/client/format'
import {
  onboardingCreateSchema,
  onboardingStatus,
  onboardingUpdateSchema,
} from '@/lib/validations/admin'

interface OnboardingRow {
  id: string
  projectName: string
  status: string | null
  kickoffDate: string | null
  targetGoLiveDate: string | null
  actualGoLiveDate: string | null
  progressPercentage: number
  currentPhase: string | null
  createdAt: string
  account: { id: string; accountName: string } | null
  _count: { tasks: number }
}

const columns: Column<OnboardingRow>[] = [
  {
    key: 'project',
    header: 'Project',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.projectName}</div>
        <div className="text-xs text-muted-foreground">{row.account?.accountName ?? ''}</div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  {
    key: 'progress',
    header: 'Progress',
    className: 'text-right',
    cell: (row) => `${row.progressPercentage ?? 0}%`,
  },
  {
    key: 'tasks',
    header: 'Tasks',
    hideOnMobile: true,
    className: 'text-right',
    cell: (row) => row._count?.tasks ?? 0,
  },
  {
    key: 'golive',
    header: 'Target go-live',
    hideOnMobile: true,
    cell: (row) => (row.targetGoLiveDate ? formatDate(row.targetGoLiveDate) : '—'),
  },
  { key: 'createdAt', header: 'Created', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
]

const config: ResourceConfig<OnboardingRow> = {
  key: 'onboarding',
  path: '/api/onboarding',
  title: 'Onboarding',
  singular: 'onboarding project',
  description: 'Implementation projects from kickoff to go-live.',
  columns,
  createPermission: 'onboarding.manage',
  editPermission: 'onboarding.manage',
  createSchema: onboardingCreateSchema,
  editSchema: onboardingUpdateSchema,
  rowLabel: (row) => row.projectName,
  filters: [{ key: 'status', label: 'Status', options: enumFilter(onboardingStatus) }],
  createFields: [
    { name: 'projectName', label: 'Project name', kind: 'text', half: true },
    {
      name: 'accountId',
      label: 'Account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    { name: 'status', label: 'Status', kind: 'select', options: onboardingStatus, half: true },
    { name: 'currentPhase', label: 'Current phase', kind: 'text', half: true },
    { name: 'kickoffDate', label: 'Kickoff', kind: 'datetime', half: true },
    { name: 'targetGoLiveDate', label: 'Target go-live', kind: 'datetime', half: true },
    {
      name: 'implementationOwnerId',
      label: 'Implementation owner',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    {
      name: 'csmOwnerId',
      label: 'CSM owner',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    { name: 'successCriteria', label: 'Success criteria', kind: 'textarea' },
    { name: 'blockers', label: 'Blockers', kind: 'textarea' },
    { name: 'dataMigrationRequired', label: 'Data migration required', kind: 'checkbox', half: true },
    { name: 'trainingRequired', label: 'Training required', kind: 'checkbox', half: true },
    { name: 'integrationRequired', label: 'Integrations required', kind: 'checkbox', half: true },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
  editFields: [
    { name: 'projectName', label: 'Project name', kind: 'text', half: true },
    { name: 'status', label: 'Status', kind: 'select', options: onboardingStatus, half: true },
    { name: 'currentPhase', label: 'Current phase', kind: 'text', half: true },
    { name: 'kickoffDate', label: 'Kickoff', kind: 'datetime', half: true },
    { name: 'targetGoLiveDate', label: 'Target go-live', kind: 'datetime', half: true },
    { name: 'blockers', label: 'Blockers', kind: 'textarea' },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
}

export default function OnboardingPage() {
  return <ResourcePage config={config} />
}
