'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime, isOverdue } from '@/lib/client/format'
import { taskCreateSchema, taskPriority, taskStatus, taskUpdateSchema } from '@/lib/validations/admin'

interface TaskRow {
  id: string
  title: string
  status: string | null
  priority: string | null
  dueAt: string | null
  completedAt: string | null
  relatedEntityType: string | null
  createdAt: string
  assignedTo: { id: string; fullName: string } | null
}

const columns: Column<TaskRow>[] = [
  {
    key: 'title',
    header: 'Task',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.title}</div>
        <div className="text-xs text-muted-foreground">
          {row.assignedTo?.fullName ?? 'Unassigned'}
          {row.relatedEntityType ? ` · ${row.relatedEntityType}` : ''}
        </div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  { key: 'priority', header: 'Priority', hideOnMobile: true, cell: (row) => <StatusBadge value={row.priority} /> },
  {
    key: 'due',
    header: 'Due',
    hideOnMobile: true,
    cell: (row) =>
      row.completedAt ? (
        <span className="text-muted-foreground">Done</span>
      ) : row.dueAt ? (
        <span className={isOverdue(row.dueAt) ? 'text-destructive' : undefined}>{formatDateTime(row.dueAt)}</span>
      ) : (
        '—'
      ),
  },
  { key: 'createdAt', header: 'Created', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
]

const config: ResourceConfig<TaskRow> = {
  key: 'tasks',
  path: '/api/tasks',
  title: 'Tasks',
  singular: 'task',
  description: 'Follow-ups for yourself and your team, tied to a record when there is one.',
  columns,
  // The tasks API is guarded by dashboard.view — there is no separate task permission.
  createPermission: 'dashboard.view',
  editPermission: 'dashboard.view',
  createSchema: taskCreateSchema,
  editSchema: taskUpdateSchema,
  rowLabel: (row) => row.title,
  filters: [
    { key: 'status', label: 'Status', options: enumFilter(taskStatus) },
    { key: 'priority', label: 'Priority', options: enumFilter(taskPriority) },
  ],
  createFields: [
    { name: 'title', label: 'Title', kind: 'text' },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'status', label: 'Status', kind: 'select', options: taskStatus, half: true },
    { name: 'priority', label: 'Priority', kind: 'select', options: taskPriority, half: true },
    { name: 'dueAt', label: 'Due at', kind: 'datetime', half: true },
    { name: 'taskType', label: 'Task type', kind: 'text', placeholder: 'follow_up', half: true },
    {
      name: 'assignedToUserId',
      label: 'Assign to',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    {
      name: 'relatedEntityType',
      label: 'Related record type',
      kind: 'select',
      options: ['lead', 'account', 'contact', 'opportunity', 'ticket', 'onboarding', 'client'],
      half: true,
    },
    {
      name: 'relatedEntityId',
      label: 'Related record id',
      kind: 'text',
      half: true,
      hint: 'Paste the record id, or leave blank for a standalone task.',
    },
    { name: 'recurrenceRule', label: 'Recurrence', kind: 'text', placeholder: 'weekly:mon', half: true },
  ],
  editFields: [
    { name: 'title', label: 'Title', kind: 'text' },
    { name: 'status', label: 'Status', kind: 'select', options: taskStatus, half: true },
    { name: 'priority', label: 'Priority', kind: 'select', options: taskPriority, half: true },
    { name: 'dueAt', label: 'Due at', kind: 'datetime', half: true },
    { name: 'completedAt', label: 'Completed at', kind: 'datetime', half: true },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ],
}

export default function TasksPage() {
  return <ResourcePage config={config} />
}
