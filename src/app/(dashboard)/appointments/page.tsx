'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime } from '@/lib/client/format'
import {
  appointmentCreateSchema,
  appointmentStatus,
  appointmentUpdateSchema,
} from '@/lib/validations/practice'

interface AppointmentRow {
  id: string
  startAt: string
  endAt: string
  status: string | null
  appointmentType: string
  paymentStatus: string | null
  timezone: string | null
  client: { id: string; clientNumber: string | null; firstName: string; lastName: string; preferredName: string | null } | null
}

const columns: Column<AppointmentRow>[] = [
  {
    key: 'client',
    header: 'Client',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">
          {row.client ? row.client.preferredName ?? `${row.client.firstName} ${row.client.lastName}` : '—'}
        </div>
        <div className="text-xs text-muted-foreground">{row.client?.clientNumber ?? ''}</div>
      </div>
    ),
  },
  { key: 'type', header: 'Appointment', cell: (row) => row.appointmentType },
  {
    key: 'when',
    header: 'Starts',
    cell: (row) => (
      <div className="space-y-0.5">
        <div>{formatDateTime(row.startAt)}</div>
        <div className="text-xs text-muted-foreground">ends {formatDateTime(row.endAt)}</div>
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (row) => <StatusBadge value={row.status} /> },
  {
    key: 'payment',
    header: 'Payment',
    hideOnMobile: true,
    cell: (row) => <StatusBadge value={row.paymentStatus} />,
  },
]

const config: ResourceConfig<AppointmentRow> = {
  key: 'appointments',
  path: '/api/appointments',
  title: 'Appointments',
  singular: 'appointment',
  description: 'Session schedule with payment state per visit.',
  columns,
  createPermission: 'appointments.create',
  editPermission: 'appointments.update',
  createSchema: appointmentCreateSchema,
  editSchema: appointmentUpdateSchema,
  rowLabel: (row) => row.appointmentType,
  filters: [{ key: 'status', label: 'Status', options: enumFilter(appointmentStatus) }],
  createFields: [
    {
      name: 'clientId',
      label: 'Client',
      kind: 'lookup',
      lookup: {
        path: '/api/clients',
        label: (row) =>
          String(row.preferredName ?? `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() ?? 'Client'),
        detail: (row) => String(row.clientNumber ?? ''),
      },
      half: true,
    },
    {
      name: 'practitionerId',
      label: 'Practitioner',
      kind: 'lookup',
      lookup: { path: '/api/users', label: (row) => String(row.fullName ?? row.email ?? 'User') },
      half: true,
    },
    { name: 'appointmentType', label: 'Appointment type', kind: 'text', placeholder: 'Initial assessment', half: true },
    { name: 'status', label: 'Status', kind: 'select', options: appointmentStatus, half: true },
    { name: 'startAt', label: 'Starts', kind: 'datetime', half: true },
    { name: 'endAt', label: 'Ends', kind: 'datetime', half: true },
    { name: 'timezone', label: 'Timezone', kind: 'text', placeholder: 'Asia/Kolkata', half: true },
    {
      name: 'paymentStatus',
      label: 'Payment status',
      kind: 'select',
      options: ['pending', 'paid', 'partially_paid', 'free', 'insurance'],
      half: true,
    },
    {
      name: 'notesVisibility',
      label: 'Notes visible to',
      kind: 'select',
      options: ['practitioner', 'front_desk', 'all'],
      half: true,
    },
    { name: 'notes', label: 'Front-desk notes', kind: 'textarea', hint: 'Never put clinical detail here.' },
  ],
  editFields: [
    { name: 'appointmentType', label: 'Appointment type', kind: 'text', half: true },
    { name: 'status', label: 'Status', kind: 'select', options: appointmentStatus, half: true },
    { name: 'startAt', label: 'Starts', kind: 'datetime', half: true },
    { name: 'endAt', label: 'Ends', kind: 'datetime', half: true },
    {
      name: 'paymentStatus',
      label: 'Payment status',
      kind: 'select',
      options: ['pending', 'paid', 'partially_paid', 'free', 'insurance'],
      half: true,
    },
    {
      name: 'notesVisibility',
      label: 'Notes visible to',
      kind: 'select',
      options: ['practitioner', 'front_desk', 'all'],
      half: true,
    },
    { name: 'notes', label: 'Front-desk notes', kind: 'textarea' },
  ],
}

export default function AppointmentsPage() {
  return <ResourcePage config={config} />
}
