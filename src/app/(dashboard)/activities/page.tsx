'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime, isOverdue } from '@/lib/client/format'
import {
  activityCreateSchema,
  activityStatus,
  activityType,
  activityUpdateSchema,
  activityVisibility,
} from '@/lib/validations/crm'

interface ActivityRow {
  id: string
  subject: string
  activityType: string | null
  status: string | null
  visibility: string | null
  priority: string | null
  dueAt: string | null
  completedAt: string | null
  createdAt: string
  assignedTo: { id: string; fullName: string } | null
}

const columns: Column<ActivityRow>[] = [
  {
    key: 'subject',
    header: 'Activity',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.subject}</div>
        <div className="text-xs text-muted-foreground">{row.assignedTo?.fullName ?? 'Unassigned'}</div>
      </div>
    ),
  },
  { key: 'type', header: 'Type', hideOnMobile: true, cell: (row) => <StatusBadge value={row.activityType} /> },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  {
    key: 'due',
    header: 'Due',
    hideOnMobile: true,
    cell: (row) =>
      row.dueAt ? (
        <span className={isOverdue(row.dueAt) && row.status !== 'completed' ? 'text-destructive' : undefined}>
          {formatDateTime(row.dueAt)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  { key: 'createdAt', header: 'Created', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
]

const config: ResourceConfig<ActivityRow> = {
  key: 'activities',
  path: '/api/activities',
  title: 'Activities',
  singular: 'activity',
  description: 'Calls, demos, meetings and notes logged against any record.',
  columns,
  createPermission: 'activities.create',
  editPermission: 'activities.update',
  createSchema: activityCreateSchema,
  editSchema: activityUpdateSchema,
  rowLabel: (row) => row.subject,
  filters: [
    { key: 'activityType', label: 'Type', options: enumFilter(activityType) },
    { key: 'status', label: 'Status', options: enumFilter(activityStatus) },
  ],
  createFields: [
    { name: 'subject', label: 'Subject', kind: 'text' },
    { name: 'activityType', label: 'Type', kind: 'select', options: activityType, half: true },
    { name: 'status', label: 'Status', kind: 'select', options: activityStatus, half: true },
    {
      name: 'priority',
      label: 'Priority',
      kind: 'select',
      options: ['low', 'normal', 'high', 'urgent'],
      half: true,
    },
    { name: 'visibility', label: 'Visibility', kind: 'select', options: activityVisibility, half: true },
    { name: 'dueAt', label: 'Due at', kind: 'datetime', half: true },
    { name: 'durationMinutes', label: 'Duration (minutes)', kind: 'number', half: true },
    {
      name: 'assignedToUserId',
      label: 'Assigned to',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    {
      name: 'relatedLeadId',
      label: 'Related lead',
      kind: 'lookup',
      lookup: { path: '/api/leads', label: (row) => String(row.fullName ?? 'Lead') },
      half: true,
    },
    {
      name: 'relatedAccountId',
      label: 'Related account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    {
      name: 'relatedContactId',
      label: 'Related contact',
      kind: 'lookup',
      lookup: { path: '/api/contacts', label: (row) => String(row.fullName ?? 'Contact') },
      half: true,
    },
    {
      name: 'relatedOpportunityId',
      label: 'Related opportunity',
      kind: 'lookup',
      lookup: { path: '/api/opportunities', label: (row) => String(row.name ?? 'Opportunity') },
      half: true,
    },
    {
      name: 'relatedTicketId',
      label: 'Related ticket',
      kind: 'lookup',
      lookup: { path: '/api/tickets', label: (row) => String(row.subject ?? 'Ticket') },
      half: true,
    },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'outcome', label: 'Outcome', kind: 'text' },
  ],
  editFields: [
    { name: 'subject', label: 'Subject', kind: 'text' },
    { name: 'activityType', label: 'Type', kind: 'select', options: activityType, half: true },
    { name: 'status', label: 'Status', kind: 'select', options: activityStatus, half: true },
    { name: 'dueAt', label: 'Due at', kind: 'datetime', half: true },
    { name: 'visibility', label: 'Visibility', kind: 'select', options: activityVisibility, half: true },
    { name: 'outcome', label: 'Outcome', kind: 'text' },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ],
}

export default function ActivitiesPage() {
  return <ResourcePage config={config} />
}
