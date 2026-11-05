'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatCurrency, formatDate, isOverdue } from '@/lib/client/format'
import {
  billingFrequency,
  subscriptionCreateSchema,
  subscriptionStatus,
  subscriptionUpdateSchema,
} from '@/lib/validations/billing'

interface SubscriptionRow {
  id: string
  status: string | null
  billingFrequency: string | null
  startDate: string
  renewalDate: string | null
  seats: number
  amount: string | number
  currency: string | null
  paymentProvider: string | null
  account: { accountName: string } | null
  plan: { name: string; monthlyPrice: string | number | null } | null
}

const columns: Column<SubscriptionRow>[] = [
  {
    key: 'account',
    header: 'Account',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.account?.accountName ?? '—'}</div>
        <div className="text-xs text-muted-foreground">{row.plan?.name ?? 'No plan'}</div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  { key: 'frequency', header: 'Billed', hideOnMobile: true, cell: (row) => <StatusBadge value={row.billingFrequency} /> },
  { key: 'seats', header: 'Seats', hideOnMobile: true, className: 'text-right', cell: (row) => row.seats },
  { key: 'amount', header: 'Amount', className: 'text-right', cell: (row) => formatCurrency(row.amount) },
  {
    key: 'renewal',
    header: 'Renews',
    hideOnMobile: true,
    cell: (row) =>
      row.renewalDate ? (
        <span className={isOverdue(row.renewalDate) ? 'text-destructive' : undefined}>
          {formatDate(row.renewalDate)}
        </span>
      ) : (
        '—'
      ),
  },
]

const config: ResourceConfig<SubscriptionRow> = {
  key: 'billing',
  path: '/api/billing',
  title: 'Billing',
  singular: 'subscription',
  description: 'Subscriptions per practice, with renewal dates and seat counts.',
  columns,
  createPermission: 'billing.manage',
  editPermission: 'billing.manage',
  createSchema: subscriptionCreateSchema,
  editSchema: subscriptionUpdateSchema,
  rowLabel: (row) => row.account?.accountName ?? 'this subscription',
  filters: [{ key: 'status', label: 'Status', options: enumFilter(subscriptionStatus) }],
  createFields: [
    {
      name: 'accountId',
      label: 'Account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    { name: 'status', label: 'Status', kind: 'select', options: subscriptionStatus, half: true },
    { name: 'billingFrequency', label: 'Frequency', kind: 'select', options: billingFrequency, half: true },
    { name: 'seats', label: 'Seats', kind: 'number', half: true },
    { name: 'amount', label: 'Amount', kind: 'number', half: true },
    { name: 'currency', label: 'Currency', kind: 'text', placeholder: 'INR', half: true },
    { name: 'startDate', label: 'Start date', kind: 'datetime', half: true },
    { name: 'renewalDate', label: 'Renewal date', kind: 'datetime', half: true },
    { name: 'paymentProvider', label: 'Payment provider', kind: 'text', placeholder: 'razorpay', half: true },
    { name: 'providerCustomerId', label: 'Provider customer id', kind: 'text', half: true },
    { name: 'providerSubscriptionId', label: 'Provider subscription id', kind: 'text', half: true },
  ],
  editFields: [
    { name: 'status', label: 'Status', kind: 'select', options: subscriptionStatus, half: true },
    { name: 'billingFrequency', label: 'Frequency', kind: 'select', options: billingFrequency, half: true },
    { name: 'seats', label: 'Seats', kind: 'number', half: true },
    { name: 'amount', label: 'Amount', kind: 'number', half: true },
    { name: 'renewalDate', label: 'Renewal date', kind: 'datetime', half: true },
  ],
}

export default function BillingPage() {
  return <ResourcePage config={config} />
}
