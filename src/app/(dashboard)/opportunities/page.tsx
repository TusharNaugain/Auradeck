'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatCurrency, formatDate } from '@/lib/client/format'
import {
  forecastCategory,
  opportunityCreateSchema,
  opportunityStage,
  opportunityType,
  opportunityUpdateSchema,
} from '@/lib/validations/crm'

interface OpportunityRow {
  id: string
  opportunityNumber: string | null
  name: string
  type: string | null
  stage: string | null
  amount: string | number
  weightedAmount: string | number
  probability: number | null
  expectedCloseDate: string | null
  forecastCategory: string | null
  createdAt: string
  account: { id: string; accountName: string } | null
  owner: { id: string; fullName: string } | null
}

const columns: Column<OpportunityRow>[] = [
  {
    key: 'name',
    header: 'Opportunity',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">{row.opportunityNumber ?? ''}</div>
      </div>
    ),
  },
  { key: 'account', header: 'Account', hideOnMobile: true, cell: (row) => row.account?.accountName ?? '—' },
  { key: 'stage', header: 'Stage', cell: (row) => <StatusBadge value={row.stage} /> },
  { key: 'amount', header: 'Amount', className: 'text-right', cell: (row) => formatCurrency(row.amount) },
  {
    key: 'weighted',
    header: 'Weighted',
    hideOnMobile: true,
    className: 'text-right',
    cell: (row) => (
      <span>
        {formatCurrency(row.weightedAmount)}
        {row.probability !== null && (
          <span className="ml-1 text-xs text-muted-foreground">({row.probability}%)</span>
        )}
      </span>
    ),
  },
  {
    key: 'close',
    header: 'Expected close',
    hideOnMobile: true,
    cell: (row) => (row.expectedCloseDate ? formatDate(row.expectedCloseDate) : '—'),
  },
  { key: 'owner', header: 'Owner', hideOnMobile: true, cell: (row) => row.owner?.fullName ?? 'Unassigned' },
]

const config: ResourceConfig<OpportunityRow> = {
  key: 'opportunities',
  path: '/api/opportunities',
  title: 'Opportunities',
  singular: 'opportunity',
  description: 'Pipeline by stage, with the weighted value the forecast uses.',
  columns,
  createPermission: 'opportunities.create',
  editPermission: 'opportunities.update',
  createSchema: opportunityCreateSchema,
  editSchema: opportunityUpdateSchema,
  rowLabel: (row) => row.name,
  filters: [
    { key: 'stage', label: 'Stage', options: enumFilter(opportunityStage) },
    { key: 'type', label: 'Type', options: enumFilter(opportunityType) },
    { key: 'forecastCategory', label: 'Forecast', options: enumFilter(forecastCategory) },
  ],
  createFields: [
    { name: 'name', label: 'Opportunity name', kind: 'text' },
    {
      name: 'accountId',
      label: 'Account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    {
      name: 'primaryContactId',
      label: 'Primary contact',
      kind: 'lookup',
      lookup: { path: '/api/contacts', label: (row) => String(row.fullName ?? 'Contact') },
      half: true,
    },
    { name: 'type', label: 'Type', kind: 'select', options: opportunityType, half: true },
    { name: 'stage', label: 'Stage', kind: 'select', options: opportunityStage, half: true },
    { name: 'amount', label: 'Amount', kind: 'number', half: true },
    { name: 'currency', label: 'Currency', kind: 'text', placeholder: 'INR', half: true },
    { name: 'probability', label: 'Probability (%)', kind: 'number', half: true },
    { name: 'forecastCategory', label: 'Forecast category', kind: 'select', options: forecastCategory, half: true },
    { name: 'expectedCloseDate', label: 'Expected close', kind: 'datetime', half: true },
    { name: 'contractStartDate', label: 'Contract start', kind: 'datetime', half: true },
    { name: 'contractEndDate', label: 'Contract end', kind: 'datetime', half: true },
    { name: 'seatsOrUsers', label: 'Seats / users', kind: 'number', half: true },
    {
      name: 'billingFrequency',
      label: 'Billing frequency',
      kind: 'select',
      options: ['monthly', 'quarterly', 'half_yearly', 'annual'],
      half: true,
    },
    { name: 'nextStep', label: 'Next step', kind: 'text' },
    { name: 'competitor', label: 'Competitor', kind: 'text', half: true },
    { name: 'source', label: 'Source', kind: 'text', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
  editFields: [
    { name: 'name', label: 'Opportunity name', kind: 'text', half: true },
    { name: 'stage', label: 'Stage', kind: 'select', options: opportunityStage, half: true },
    { name: 'amount', label: 'Amount', kind: 'number', half: true },
    { name: 'probability', label: 'Probability (%)', kind: 'number', half: true },
    { name: 'forecastCategory', label: 'Forecast category', kind: 'select', options: forecastCategory, half: true },
    { name: 'expectedCloseDate', label: 'Expected close', kind: 'datetime', half: true },
    { name: 'nextStep', label: 'Next step', kind: 'text' },
    { name: 'lossReason', label: 'Loss reason', kind: 'textarea' },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
}

export default function OpportunitiesPage() {
  return <ResourcePage config={config} />
}
