'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/client/format'
import { accountCreateSchema, accountUpdateSchema, healthStatus } from '@/lib/validations/crm'

interface AccountRow {
  id: string
  customerAccountCode: string | null
  accountName: string
  accountType: string | null
  segment: string | null
  healthStatus: string | null
  healthScore: number | null
  mrr: string | number | null
  renewalDate: string | null
  createdAt: string
}

const columns: Column<AccountRow>[] = [
  {
    key: 'account',
    header: 'Account',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.accountName}</div>
        <div className="text-xs text-muted-foreground">{row.customerAccountCode ?? row.segment ?? ''}</div>
      </div>
    ),
  },
  { key: 'health', header: 'Health', cell: (row) => <StatusBadge value={row.healthStatus} /> },
  {
    key: 'score',
    header: 'Score',
    hideOnMobile: true,
    className: 'text-right',
    cell: (row) => row.healthScore ?? '—',
  },
  {
    key: 'mrr',
    header: 'MRR',
    className: 'text-right',
    cell: (row) => (row.mrr === null ? '—' : formatCurrency(row.mrr, { compact: true })),
  },
  {
    key: 'renewal',
    header: 'Renewal',
    hideOnMobile: true,
    cell: (row) => (row.renewalDate ? formatDate(row.renewalDate) : '—'),
  },
  { key: 'createdAt', header: 'Added', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
]

const config: ResourceConfig<AccountRow> = {
  key: 'accounts',
  path: '/api/accounts',
  title: 'Accounts',
  singular: 'account',
  description: 'Every practice you sell to, serve and renew.',
  columns,
  createPermission: 'accounts.create',
  editPermission: 'accounts.update',
  createSchema: accountCreateSchema,
  editSchema: accountUpdateSchema,
  rowLabel: (row) => row.accountName,
  filters: [{ key: 'healthStatus', label: 'Health', options: enumFilter(healthStatus) }],
  createFields: [
    { name: 'accountName', label: 'Account name', kind: 'text', half: true },
    { name: 'customerAccountCode', label: 'Account code', kind: 'text', half: true },
    { name: 'accountType', label: 'Type', kind: 'text', placeholder: 'Clinic, hospital, wellness studio', half: true },
    { name: 'segment', label: 'Segment', kind: 'text', half: true },
    { name: 'lifecycleStage', label: 'Lifecycle stage', kind: 'text', half: true },
    { name: 'healthStatus', label: 'Health', kind: 'select', options: healthStatus, half: true },
    { name: 'healthScore', label: 'Health score (0-100)', kind: 'number', half: true },
    {
      name: 'expansionPotential',
      label: 'Expansion potential',
      kind: 'select',
      options: ['low', 'medium', 'high'],
      half: true,
    },
    { name: 'mrr', label: 'MRR', kind: 'number', half: true },
    { name: 'arr', label: 'ARR', kind: 'number', half: true },
    { name: 'contractValue', label: 'Contract value', kind: 'number', half: true },
    { name: 'paymentStatus', label: 'Payment status', kind: 'text', half: true },
    { name: 'renewalDate', label: 'Renewal date', kind: 'datetime', half: true },
    { name: 'nextBusinessReviewAt', label: 'Next business review', kind: 'datetime', half: true },
    { name: 'npsScore', label: 'NPS (0-10)', kind: 'number', half: true },
    { name: 'licensedUsersCount', label: 'Licensed users', kind: 'number', half: true },
    { name: 'activeUsersCount', label: 'Active users', kind: 'number', half: true },
    { name: 'competitors', label: 'Competitors', kind: 'text' },
    { name: 'riskReason', label: 'Risk reason', kind: 'textarea' },
    { name: 'strategicNotes', label: 'Strategic notes', kind: 'textarea' },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
  editFields: [
    { name: 'accountName', label: 'Account name', kind: 'text', half: true },
    { name: 'segment', label: 'Segment', kind: 'text', half: true },
    { name: 'healthStatus', label: 'Health', kind: 'select', options: healthStatus, half: true },
    { name: 'healthScore', label: 'Health score (0-100)', kind: 'number', half: true },
    { name: 'mrr', label: 'MRR', kind: 'number', half: true },
    { name: 'renewalDate', label: 'Renewal date', kind: 'datetime', half: true },
    { name: 'paymentStatus', label: 'Payment status', kind: 'text', half: true },
    { name: 'riskReason', label: 'Risk reason', kind: 'textarea' },
    { name: 'strategicNotes', label: 'Strategic notes', kind: 'textarea' },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
}

export default function AccountsPage() {
  return <ResourcePage config={config} />
}
