'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime } from '@/lib/client/format'
import {
  ticketCreateSchema,
  ticketPriority,
  ticketSource,
  ticketStatus,
  ticketUpdateSchema,
} from '@/lib/validations/support'

interface TicketRow {
  id: string
  ticketNumber: string | null
  subject: string
  priority: string | null
  status: string | null
  slaStatus: string | null
  firstResponseDueAt: string | null
  resolutionDueAt: string | null
  resolvedAt: string | null
  createdAt: string
  account: { id: string; accountName: string } | null
  assignedTo: { id: string; fullName: string } | null
}

const columns: Column<TicketRow>[] = [
  {
    key: 'subject',
    header: 'Ticket',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.subject}</div>
        <div className="text-xs text-muted-foreground">
          {row.ticketNumber ?? ''}
          {row.account ? ` · ${row.account.accountName}` : ''}
        </div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  { key: 'priority', header: 'Priority', cell: (row) => <StatusBadge value={row.priority} /> },
  {
    key: 'sla',
    header: 'SLA',
    hideOnMobile: true,
    cell: (row) => <StatusBadge value={row.slaStatus} />,
  },
  {
    key: 'due',
    header: 'Resolve by',
    hideOnMobile: true,
    cell: (row) => (row.resolvedAt ? 'Resolved' : row.resolutionDueAt ? formatDateTime(row.resolutionDueAt) : '—'),
  },
  { key: 'owner', header: 'Assignee', hideOnMobile: true, cell: (row) => row.assignedTo?.fullName ?? 'Unassigned' },
]

const config: ResourceConfig<TicketRow> = {
  key: 'tickets',
  path: '/api/tickets',
  title: 'Support tickets',
  singular: 'ticket',
  description: 'Requests with SLA clocks driven by priority.',
  columns,
  createPermission: 'tickets.create',
  editPermission: 'tickets.update',
  createSchema: ticketCreateSchema,
  editSchema: ticketUpdateSchema,
  rowLabel: (row) => row.subject,
  filters: [
    { key: 'status', label: 'Status', options: enumFilter(ticketStatus) },
    { key: 'priority', label: 'Priority', options: enumFilter(ticketPriority) },
    {
      key: 'slaStatus',
      label: 'SLA',
      options: [
        { value: 'on_time', label: 'On time' },
        { value: 'at_risk', label: 'At risk' },
        { value: 'breached', label: 'Breached' },
      ],
    },
  ],
  createFields: [
    { name: 'subject', label: 'Subject', kind: 'text' },
    { name: 'description', label: 'Description', kind: 'textarea' },
    {
      name: 'accountId',
      label: 'Account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    {
      name: 'contactId',
      label: 'Contact',
      kind: 'lookup',
      lookup: { path: '/api/contacts', label: (row) => String(row.fullName ?? 'Contact') },
      half: true,
    },
    { name: 'priority', label: 'Priority', kind: 'select', options: ticketPriority, half: true },
    { name: 'source', label: 'Source', kind: 'select', options: ticketSource, half: true },
    { name: 'category', label: 'Category', kind: 'text', half: true },
    { name: 'subcategory', label: 'Sub-category', kind: 'text', half: true },
    {
      name: 'assignedToUserId',
      label: 'Assignee',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    {
      name: 'teamId',
      label: 'Team',
      kind: 'lookup',
      lookup: { path: '/api/teams', label: (row) => String(row.name ?? 'Team') },
      half: true,
    },
    { name: 'internalNotes', label: 'Internal notes', kind: 'textarea', hint: 'Never shown to the customer.' },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
  editFields: [
    { name: 'subject', label: 'Subject', kind: 'text' },
    { name: 'status', label: 'Status', kind: 'select', options: ticketStatus, half: true },
    { name: 'priority', label: 'Priority', kind: 'select', options: ticketPriority, half: true },
    {
      name: 'assignedToUserId',
      label: 'Assignee',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    { name: 'category', label: 'Category', kind: 'text', half: true },
    { name: 'satisfactionScore', label: 'CSAT (1-5)', kind: 'number', half: true },
    { name: 'internalNotes', label: 'Internal notes', kind: 'textarea' },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
}

export default function TicketsPage() {
  return <ResourcePage config={config} />
}
