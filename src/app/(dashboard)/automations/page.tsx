'use client'

import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime } from '@/lib/client/format'
import {
  automationCreateSchema,
  automationTriggerSchema,
  automationUpdateSchema,
} from '@/lib/validations/admin'

interface AutomationRow {
  id: string
  name: string
  description: string | null
  trigger: string | null
  status: string | null
  conditions: unknown
  actions: unknown
  delaySeconds: number | null
  updatedAt: string
  _count: { executions: number }
}

const countOf = (value: unknown) => (Array.isArray(value) ? value.length : 0)

const columns: Column<AutomationRow>[] = [
  {
    key: 'name',
    header: 'Rule',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-muted-foreground">{row.description ?? ''}</div>
      </div>
    ),
  },
  { key: 'trigger', header: 'Trigger', cell: (row) => <StatusBadge value={row.trigger} /> },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  {
    key: 'actions',
    header: 'Actions',
    hideOnMobile: true,
    className: 'text-right',
    cell: (row) => countOf(row.actions),
  },
  {
    key: 'executions',
    header: 'Runs',
    hideOnMobile: true,
    className: 'text-right',
    cell: (row) => row._count?.executions ?? 0,
  },
  { key: 'updated', header: 'Updated', hideOnMobile: true, cell: (row) => formatDateTime(row.updatedAt) },
]

const ACTIONS_EXAMPLE = '[\n  { "type": "create_task", "payload": { "title": "Call the new lead" } }\n]'

const config: ResourceConfig<AutomationRow> = {
  key: 'automations',
  path: '/api/automations',
  title: 'Automations',
  singular: 'automation rule',
  description: 'Declarative rules that turn events into follow-up work.',
  columns,
  createPermission: 'automations.manage',
  editPermission: 'automations.manage',
  createSchema: automationCreateSchema,
  editSchema: automationUpdateSchema,
  rowLabel: (row) => row.name,
  filters: [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
        { value: 'draft', label: 'Draft' },
      ],
    },
  ],
  createFields: [
    { name: 'name', label: 'Rule name', kind: 'text', half: true },
    {
      name: 'trigger',
      label: 'Trigger',
      kind: 'select',
      options: automationTriggerSchema,
      half: true,
    },
    {
      name: 'status',
      label: 'Status',
      kind: 'select',
      options: ['active', 'inactive', 'draft'],
      half: true,
    },
    { name: 'delaySeconds', label: 'Delay (seconds)', kind: 'number', half: true },
    { name: 'description', label: 'Description', kind: 'textarea' },
    {
      name: 'conditions',
      label: 'Conditions (JSON)',
      kind: 'json',
      placeholder: '[]',
      hint: 'Array of { field, operator, value }. Operators: equals, not_equals, in, contains, greater_than, less_than.',
    },
    {
      name: 'actions',
      label: 'Actions (JSON)',
      kind: 'json',
      placeholder: ACTIONS_EXAMPLE,
      hint: 'Required. Types: create_task, notify, assign_user, move_stage.',
    },
  ],
  editFields: [
    { name: 'name', label: 'Rule name', kind: 'text', half: true },
    { name: 'trigger', label: 'Trigger', kind: 'select', options: automationTriggerSchema, half: true },
    { name: 'status', label: 'Status', kind: 'select', options: ['active', 'inactive', 'draft'], half: true },
    { name: 'delaySeconds', label: 'Delay (seconds)', kind: 'number', half: true },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'conditions', label: 'Conditions (JSON)', kind: 'json', placeholder: '[]' },
    { name: 'actions', label: 'Actions (JSON)', kind: 'json', placeholder: ACTIONS_EXAMPLE },
  ],
}

export default function AutomationsPage() {
  return <ResourcePage config={config} />
}
