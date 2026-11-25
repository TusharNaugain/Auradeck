/**
 * Extra contacts on a lead: numbers, emails and social profiles the team adds on top of
 * the email / phone that came from the lead source. Source fields stay read-only.
 * Stored as a JSON array in `leads.extraContacts`.
 */

import { randomUUID } from 'crypto'
import type { ExtraContactInput } from '@/lib/validations/crm'
import { ValidationFailedError } from '@/lib/services/errors'
import { normalizePhone } from '@/lib/validations/common'

export interface ExtraContact {
  id: string
  type: ExtraContactInput['type']
  value: string
  label?: string
  addedAt: string
  addedBy: string
}

export const MAX_EXTRA_CONTACTS = 20

const SOURCE_FIELDS = [
  { body: 'email', column: 'email', label: 'Email' },
  { body: 'phone', column: 'phoneNumber', label: 'Phone' },
  { body: 'alternatePhone', column: 'alternatePhone', label: 'Alternate phone' },
  { body: 'whatsappNumber', column: 'whatsappNumber', label: 'WhatsApp number' },
] as const

type SourceColumns = { email: string | null; phoneNumber: string | null; alternatePhone: string | null; whatsappNumber: string | null }

/**
 * Source contact fields the update would overwrite. A blank field may still be filled in
 * once; re-sending the same value is not a change.
 */
export function lockedSourceFields(lead: SourceColumns, body: Record<string, unknown>): string[] {
  return SOURCE_FIELDS.filter(({ body: key, column }) => {
    if (body[key] === undefined) return false
    const current = lead[column]
    if (!current) return false
    const next = body[key]
    if (typeof next !== 'string') return true
    const same = key === 'email' ? next.trim().toLowerCase() === current.toLowerCase() : normalizePhone(next) === normalizePhone(current)
    return !same
  }).map(({ label }) => label)
}

export function parseExtraContacts(value: unknown): ExtraContact[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ExtraContact =>
    !!item && typeof item === 'object' &&
    typeof (item as ExtraContact).id === 'string' &&
    typeof (item as ExtraContact).type === 'string' &&
    typeof (item as ExtraContact).value === 'string')
}

function canonicalValue(contact: Pick<ExtraContact, 'type' | 'value'>): string {
  if (contact.type === 'phone' || contact.type === 'whatsapp') return normalizePhone(contact.value)
  if (contact.type === 'email') return contact.value.trim().toLowerCase()
  return contact.value.trim()
}

export function addExtraContact(list: ExtraContact[], input: ExtraContactInput, userId: string, now = new Date()): ExtraContact[] {
  if (list.length >= MAX_EXTRA_CONTACTS) throw new ValidationFailedError(`A lead can have at most ${MAX_EXTRA_CONTACTS} extra contacts`)
  const value = canonicalValue(input)
  if (list.some((item) => item.type === input.type && canonicalValue(item) === value)) {
    throw new ValidationFailedError('This contact is already on the lead')
  }
  return [
    ...list,
    { id: randomUUID(), type: input.type, value, ...(input.label ? { label: input.label } : {}), addedAt: now.toISOString(), addedBy: userId },
  ]
}

export function removeExtraContact(list: ExtraContact[], id: string): ExtraContact[] {
  if (!list.some((item) => item.id === id)) throw new ValidationFailedError('Extra contact not found')
  return list.filter((item) => item.id !== id)
}
