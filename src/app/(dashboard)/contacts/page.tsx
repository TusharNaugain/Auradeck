'use client'

import { enumFilter } from '@/components/shared/filter-bar'
import { StatusBadge } from '@/components/shared/status-badge'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import type { Column } from '@/components/shared/table-utils'
import { formatDateTime } from '@/lib/client/format'
import { contactCreateSchema, contactType, contactUpdateSchema } from '@/lib/validations/crm'

interface ContactRow {
  id: string
  fullName: string | null
  preferredName: string | null
  email: string | null
  jobTitle: string | null
  contactType: string | null
  isDecisionMaker: boolean
  lastContactedAt: string | null
  createdAt: string
}

const columns: Column<ContactRow>[] = [
  {
    key: 'name',
    header: 'Contact',
    cell: (row) => (
      <div className="space-y-0.5">
        <div className="font-medium">{row.preferredName ?? row.fullName ?? '—'}</div>
        <div className="text-xs text-muted-foreground">{row.jobTitle ?? ''}</div>
      </div>
    ),
  },
  { key: 'email', header: 'Email', cell: (row) => row.email ?? '—' },
  { key: 'type', header: 'Type', hideOnMobile: true, cell: (row) => <StatusBadge value={row.contactType} /> },
  {
    key: 'dm',
    header: 'Decision maker',
    hideOnMobile: true,
    cell: (row) => (row.isDecisionMaker ? 'Yes' : '—'),
  },
  {
    key: 'lastContacted',
    header: 'Last contacted',
    hideOnMobile: true,
    cell: (row) => (row.lastContactedAt ? formatDateTime(row.lastContactedAt) : 'Never'),
  },
  { key: 'createdAt', header: 'Added', hideOnMobile: true, cell: (row) => formatDateTime(row.createdAt) },
]

const config: ResourceConfig<ContactRow> = {
  key: 'contacts',
  path: '/api/contacts',
  title: 'Contacts',
  singular: 'contact',
  description: 'The people inside each practice account.',
  columns,
  createPermission: 'contacts.create',
  editPermission: 'contacts.update',
  createSchema: contactCreateSchema,
  editSchema: contactUpdateSchema,
  rowLabel: (row) => row.fullName ?? 'this contact',
  filters: [{ key: 'contactType', label: 'Type', options: enumFilter(contactType) }],
  createFields: [
    { name: 'firstName', label: 'First name', kind: 'text', half: true },
    { name: 'lastName', label: 'Last name', kind: 'text', half: true },
    { name: 'preferredName', label: 'Preferred name', kind: 'text', half: true },
    { name: 'jobTitle', label: 'Job title', kind: 'text', half: true },
    { name: 'email', label: 'Email', kind: 'email', half: true },
    { name: 'secondaryEmail', label: 'Secondary email', kind: 'email', half: true },
    { name: 'phone', label: 'Phone', kind: 'tel', half: true },
    { name: 'department', label: 'Department', kind: 'text', half: true },
    { name: 'preferredLanguage', label: 'Preferred language', kind: 'text', half: true },
    { name: 'contactType', label: 'Contact type', kind: 'select', options: contactType, half: true },
    {
      name: 'influenceLevel',
      label: 'Influence',
      kind: 'select',
      options: ['low', 'medium', 'high'],
      half: true,
    },
    {
      name: 'accountId',
      label: 'Account',
      kind: 'lookup',
      lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') },
      half: true,
    },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
    { name: 'isPrimary', label: 'Primary contact', kind: 'checkbox', half: true },
    { name: 'isDecisionMaker', label: 'Decision maker', kind: 'checkbox', half: true },
    { name: 'doNotContact', label: 'Do not contact', kind: 'checkbox', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
  editFields: [
    { name: 'firstName', label: 'First name', kind: 'text', half: true },
    { name: 'lastName', label: 'Last name', kind: 'text', half: true },
    { name: 'preferredName', label: 'Preferred name', kind: 'text', half: true },
    { name: 'jobTitle', label: 'Job title', kind: 'text', half: true },
    { name: 'email', label: 'Email', kind: 'email', half: true },
    { name: 'phone', label: 'Phone', kind: 'tel', half: true },
    { name: 'contactType', label: 'Contact type', kind: 'select', options: contactType, half: true },
    { name: 'accountId', label: 'Account', kind: 'lookup', lookup: { path: '/api/accounts', label: (row) => String(row.accountName ?? 'Account') }, half: true },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
    { name: 'isDecisionMaker', label: 'Decision maker', kind: 'checkbox', half: true },
    { name: 'doNotContact', label: 'Do not contact', kind: 'checkbox', half: true },
    { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Comma separated' },
  ],
}

export default function ContactsPage() {
  return <ResourcePage config={config} />
}
