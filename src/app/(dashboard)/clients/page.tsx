'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatCurrency, formatDateTime } from '@/lib/client/format'
import { clientCreateSchema, clientStatus, clientUpdateSchema } from '@/lib/validations/practice'

interface ClientRow {
  id: string
  clientNumber: string | null
  firstName: string
  lastName: string
  preferredName: string | null
  status: string | null
  lastAppointmentAt: string | null
  nextAppointmentAt: string | null
  outstandingBalance: string | number | null
  createdAt: string
}

const columns: Column<ClientRow>[] = [
  {
    key: 'client',
    header: 'Client',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.preferredName ?? `${row.firstName} ${row.lastName}`}</div>
        <div className="text-xs text-muted-foreground">{row.clientNumber ?? ''}</div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  {
    key: 'last',
    header: 'Last session',
    hideOnMobile: true,
    cell: (row) => (row.lastAppointmentAt ? formatDateTime(row.lastAppointmentAt) : 'No sessions yet'),
  },
  {
    key: 'next',
    header: 'Next appointment',
    hideOnMobile: true,
    cell: (row) => (row.nextAppointmentAt ? formatDateTime(row.nextAppointmentAt) : '—'),
  },
  {
    key: 'balance',
    header: 'Outstanding',
    className: 'text-right',
    cell: (row) => (row.outstandingBalance ? formatCurrency(row.outstandingBalance) : '—'),
  },
]

const config: ResourceConfig<ClientRow> = {
  key: 'clients',
  path: '/api/clients',
  title: 'Clients',
  singular: 'client',
  description: 'People receiving care. Clinical detail stays in notes, never in CRM lists.',
  columns,
  createPermission: 'clients.create',
  editPermission: 'clients.update',
  createSchema: clientCreateSchema,
  editSchema: clientUpdateSchema,
  rowLabel: (row) => `${row.firstName} ${row.lastName}`,
  filters: [{ key: 'status', label: 'Status', options: enumFilter(clientStatus) }],
  createFields: [
    { name: 'firstName', label: 'First name', kind: 'text', half: true },
    { name: 'lastName', label: 'Last name', kind: 'text', half: true },
    { name: 'preferredName', label: 'Preferred name', kind: 'text', half: true },
    { name: 'status', label: 'Status', kind: 'select', options: clientStatus, half: true },
    { name: 'email', label: 'Email', kind: 'email', half: true },
    { name: 'phone', label: 'Phone', kind: 'tel', half: true },
    { name: 'dateOfBirth', label: 'Date of birth', kind: 'date', half: true },
    { name: 'gender', label: 'Gender', kind: 'text', half: true },
    { name: 'pronouns', label: 'Pronouns', kind: 'text', half: true },
    {
      name: 'assignedPractitionerId',
      label: 'Assigned practitioner',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    { name: 'referralSource', label: 'Referral source', kind: 'text', half: true },
    { name: 'consentStatus', label: 'Consent status', kind: 'text', half: true },
    { name: 'emergencyContactName', label: 'Emergency contact', kind: 'text', half: true },
    { name: 'emergencyContactPhone', label: 'Emergency phone', kind: 'tel', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
  editFields: [
    { name: 'firstName', label: 'First name', kind: 'text', half: true },
    { name: 'lastName', label: 'Last name', kind: 'text', half: true },
    { name: 'preferredName', label: 'Preferred name', kind: 'text', half: true },
    { name: 'status', label: 'Status', kind: 'select', options: clientStatus, half: true },
    { name: 'email', label: 'Email', kind: 'email', half: true },
    { name: 'phone', label: 'Phone', kind: 'tel', half: true },
    {
      name: 'assignedPractitionerId',
      label: 'Assigned practitioner',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    { name: 'consentStatus', label: 'Consent status', kind: 'text', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
}

export default function ClientsPage() {
  return <ResourcePage config={config} />
}
