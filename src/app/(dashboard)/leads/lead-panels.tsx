'use client'

import * as React from 'react'
import { ArrowRight, Check, Info, Lock, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/client/api'
import { errorMessage, useInvalidate } from '@/lib/client/hooks'
import { enumLabel, formatDate, formatRelative } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { DEMO_MODE } from '@/lib/demo-mode'
import { toast } from 'sonner'
import { LEAD_STAGES, STAGE_INFO, stageTitle, type LeadStage } from '@/lib/leads/stages'
import { EXTRA_CONTACT_TYPES } from '@/lib/validations/crm'

export interface ExtraContactView {
  id: string
  type: string
  value: string
  label?: string
  addedAt?: string
}

/** Colour dot for a stage, used by the board, badges and the guide. */
export function stageColor(stage: string) {
  switch (stage) {
    case 'NEW': return 'bg-slate-400'
    case 'CONTACTED': return 'bg-sky-500'
    case 'INTERESTED': return 'bg-cyan-500'
    case 'DEMO_SCHEDULED': return 'bg-violet-500'
    case 'DEMO_ATTENDED': return 'bg-indigo-500'
    case 'SIGNED_UP': return 'bg-amber-500'
    case 'ACTIVATED': return 'bg-lime-500'
    case 'PAID': return 'bg-emerald-500'
    case 'CHURNED': return 'bg-orange-500'
    case 'LOST': return 'bg-rose-500'
    default: return 'bg-muted-foreground'
  }
}

async function patchLead(leadId: string, body: Record<string, unknown>) {
  await api.patch(`/api/leads/${leadId}`, body)
}

function useLeadSaver(leadId: string) {
  const invalidate = useInvalidate()
  const [pending, setPending] = React.useState(false)
  const save = React.useCallback(async (body: Record<string, unknown>, success: string) => {
    setPending(true)
    try {
      await patchLead(leadId, body)
      toast.success(DEMO_MODE ? `${success} (saved in this browser)` : success)
      invalidate(['lead', leadId])
      invalidate(['leads'])
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      setPending(false)
    }
  }, [leadId, invalidate])
  return { save, pending }
}

/** What each stage means and what to do there — the sales playbook, always one click away. */
export function StageGuide() {
  return (
    <details className="group rounded-xl border border-border/70 bg-muted/20 px-4 py-2.5 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
        <Info className="size-4 text-muted-foreground" />
        Stage guide — what each stage means
        <span className="text-xs font-normal text-muted-foreground group-open:hidden">(show)</span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Stage</th>
              <th className="py-1.5 pr-3 font-medium">Meaning</th>
              <th className="py-1.5 font-medium">What to do</th>
            </tr>
          </thead>
          <tbody>
            {LEAD_STAGES.map((stage) => (
              <tr key={stage} className="border-t border-border/60 align-top">
                <td className="whitespace-nowrap py-1.5 pr-3 font-medium">
                  <span className={cn('mr-2 inline-block size-2 rounded-full', stageColor(stage))} />
                  {stageTitle(stage)}
                </td>
                <td className="py-1.5 pr-3">{STAGE_INFO[stage].meaning}</td>
                <td className="py-1.5 text-muted-foreground">{STAGE_INFO[stage].todo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Every lead keeps: Name, Work email, Role / practice type, Source, Stage, Last contact date, Next action and Owner.
        </p>
      </div>
    </details>
  )
}

export function LeadNameEditor({
  lead,
  canUpdate,
  children,
}: {
  lead: { id: string; fullName: string; firstName?: string; lastName?: string }
  canUpdate: boolean
  children: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const { save, pending } = useLeadSaver(lead.id)

  function start() {
    const [first, ...rest] = lead.fullName.split(' ')
    setFirstName(lead.firstName ?? first ?? '')
    setLastName(lead.lastName ?? rest.join(' '))
    setEditing(true)
  }
  React.useEffect(() => { setEditing(false) }, [lead.id])

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        {children}
        {canUpdate && (
          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Edit name" title="Edit name" onClick={start}>
            <Pencil className="size-3.5" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!firstName.trim()) { toast.error('First name is required'); return }
        void save({ firstName: firstName.trim(), lastName: lastName.trim() }, 'Name updated').then((ok) => { if (ok) setEditing(false) })
      }}
    >
      <Input aria-label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} className="h-8 w-36" autoFocus disabled={pending} />
      <Input aria-label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} className="h-8 w-36" placeholder="Last name" disabled={pending} />
      <Button type="submit" size="sm" className="h-8" disabled={pending}><Check className="size-4" />Save</Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
    </form>
  )
}

/** Current stage, what it means, what to do, and how to move on. */
export function LeadStagePanel({
  stage,
  canUpdate,
  onStageChange,
}: {
  stage: string
  canUpdate: boolean
  onStageChange: (stage: LeadStage) => void
}) {
  const info = STAGE_INFO[stage as LeadStage]
  const index = LEAD_STAGES.indexOf(stage as LeadStage)
  const next = stage === 'LOST' || stage === 'CHURNED' || stage === 'PAID' ? null : LEAD_STAGES[index + 1] ?? null
  return (
    <section className="rounded-xl border border-border/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stage</p>
          <p className="mt-1 flex items-center gap-2 text-base font-semibold">
            <span className={cn('size-2.5 rounded-full', stageColor(stage))} />
            {stageTitle(stage)}
          </p>
          {info && <p className="mt-1 text-sm">{info.meaning}</p>}
          {info && <p className="mt-0.5 text-xs text-muted-foreground">To do: {info.todo}</p>}
        </div>
        {canUpdate && (
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <select
              aria-label="Change stage"
              value={stage}
              onChange={(event) => onStageChange(event.target.value as LeadStage)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {LEAD_STAGES.map((item) => <option key={item} value={item}>{stageTitle(item)}</option>)}
            </select>
            {next && next !== 'LOST' && (
              <Button size="sm" variant="outline" onClick={() => onStageChange(next)}>
                Move to {stageTitle(next)}
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function InlineText({
  label,
  value,
  placeholder,
  maxLength,
  canUpdate,
  onSave,
}: {
  label: string
  value: string | null | undefined
  placeholder: string
  maxLength: number
  canUpdate: boolean
  onSave: (value: string) => Promise<boolean>
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')
  const [pending, setPending] = React.useState(false)
  React.useEffect(() => { setDraft(value ?? ''); setEditing(false) }, [value])

  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      {editing ? (
        <form
          className="mt-1 flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            setPending(true)
            void onSave(draft.trim()).then((ok) => { setPending(false); if (ok) setEditing(false) })
          }}
        >
          <Input aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={maxLength} placeholder={placeholder} className="h-8" autoFocus disabled={pending} />
          <Button type="submit" size="sm" className="h-8 px-2" aria-label={`Save ${label}`} disabled={pending}><Check className="size-4" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label="Cancel" onClick={() => setEditing(false)} disabled={pending}><X className="size-4" /></Button>
        </form>
      ) : (
        <button
          type="button"
          disabled={!canUpdate}
          onClick={() => setEditing(true)}
          className={cn('mt-0.5 flex max-w-full items-center gap-1.5 text-left text-sm font-medium', canUpdate && 'hover:underline')}
        >
          <span className={cn('truncate', !value && 'font-normal text-muted-foreground')}>{value || (canUpdate ? placeholder : '—')}</span>
          {canUpdate && <Pencil className="size-3 shrink-0 text-muted-foreground" />}
        </button>
      )}
    </div>
  )
}

/** The eight fields every lead keeps, in the playbook's order. */
export function LeadKeyFields({
  lead,
  canUpdate,
  owner,
}: {
  lead: {
    id: string
    fullName: string
    email: string | null
    jobTitle?: string | null
    leadSource: string
    sourceDetail?: string | null
    lifecycleStage: string
    lastContactedAt: string | null
    firstContactedAt?: string | null
    nextAction?: string | null
    customFields?: Record<string, unknown> | null
  }
  canUpdate: boolean
  owner: React.ReactNode
}) {
  const { save } = useLeadSaver(lead.id)
  const sheetSource = typeof lead.customFields?.waitlistSource === 'string' ? lead.customFields.waitlistSource : null
  const source = [enumLabel(lead.leadSource), lead.sourceDetail || sheetSource].filter(Boolean).join(' · ')
  return (
    <section className="rounded-xl border border-border/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lead card</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <KeyField label="Name" value={lead.fullName} />
        <KeyField label="Work email" value={lead.email} />
        <InlineText
          label="Role / practice type"
          value={lead.jobTitle}
          placeholder="e.g. Psychologist, clinic owner"
          maxLength={100}
          canUpdate={canUpdate}
          onSave={(value) => save({ jobTitle: value || null }, 'Role saved')}
        />
        <KeyField label="Source" value={source} hint={lead.firstContactedAt ? `First contacted ${formatDate(lead.firstContactedAt)}` : undefined} />
        <KeyField label="Stage" value={stageTitle(lead.lifecycleStage)} />
        <KeyField label="Last contact date" value={lead.lastContactedAt ? `${formatDate(lead.lastContactedAt)} · ${formatRelative(lead.lastContactedAt)}` : null} hint="Updates when you log an interaction" />
        <InlineText
          label="Next action"
          value={lead.nextAction}
          placeholder="e.g. Send demo reminder"
          maxLength={200}
          canUpdate={canUpdate}
          onSave={(value) => save({ nextAction: value || null }, 'Next action saved')}
        />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Owner</p>
          <div className="mt-0.5">{owner}</div>
        </div>
      </div>
    </section>
  )
}

function KeyField({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 break-words text-sm font-medium', !value && 'font-normal text-muted-foreground')}>{value || '—'}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

const TYPE_LABEL: Record<string, string> = {
  phone: 'Phone',
  email: 'Email',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  website: 'Website',
  other: 'Other',
}

const PLACEHOLDER: Record<string, string> = {
  phone: '+91 98765 43210',
  whatsapp: '+91 98765 43210',
  email: 'name@practice.com',
  linkedin: 'linkedin.com/in/…',
  instagram: '@handle or profile link',
  facebook: 'facebook.com/…',
  twitter: '@handle',
  website: 'practice.com',
  other: 'Any other contact',
}

function contactHref(contact: ExtraContactView): string | undefined {
  const v = contact.value.trim()
  if (contact.type === 'phone') return `tel:${v}`
  if (contact.type === 'email') return `mailto:${v}`
  if (contact.type === 'whatsapp') return `https://wa.me/${v.replace(/[^\d]/g, '')}`
  if (contact.type === 'instagram' && v.startsWith('@')) return `https://instagram.com/${v.slice(1)}`
  if (contact.type === 'twitter' && v.startsWith('@')) return `https://x.com/${v.slice(1)}`
  if (['linkedin', 'instagram', 'facebook', 'twitter', 'website'].includes(contact.type)) {
    try {
      const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`)
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Extra numbers / emails / social profiles. The source email & phone above stay read-only. */
export function ExtraContacts({
  leadId,
  contacts,
  canUpdate,
}: {
  leadId: string
  contacts: ExtraContactView[]
  canUpdate: boolean
}) {
  const [adding, setAdding] = React.useState(false)
  const [type, setType] = React.useState<string>('phone')
  const [value, setValue] = React.useState('')
  const [label, setLabel] = React.useState('')
  const { save, pending } = useLeadSaver(leadId)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    const ok = await save({ addExtraContact: { type, value: value.trim(), ...(label.trim() ? { label: label.trim() } : {}) } }, 'Contact added')
    if (ok) { setValue(''); setLabel(''); setAdding(false) }
  }

  async function remove(contact: ExtraContactView) {
    if (!window.confirm(`Remove ${TYPE_LABEL[contact.type] ?? contact.type} ${contact.value} from this lead?`)) return
    await save({ removeExtraContactId: contact.id }, 'Contact removed')
  }

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Added by the team</p>
        {canUpdate && !adding && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add contact
          </Button>
        )}
      </div>
      {contacts.length === 0 && !adding && (
        <p className="mt-2 text-xs text-muted-foreground">No extra contacts yet. Add another number, email or a social profile (LinkedIn, Instagram…).</p>
      )}
      {contacts.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {contacts.map((contact) => {
            const href = contactHref(contact)
            return (
              <li key={contact.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{TYPE_LABEL[contact.type] ?? contact.type}{contact.label ? ` · ${contact.label}` : ''}</p>
                  {href
                    ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="break-all text-sm hover:underline">{contact.value}</a>
                    : <p className="break-all text-sm">{contact.value}</p>}
                </div>
                {canUpdate && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" aria-label={`Remove ${contact.value}`} onClick={() => void remove(contact)} disabled={pending}>
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {adding && (
        <form onSubmit={(event) => void add(event)} className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
          <select aria-label="Contact type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm" disabled={pending}>
            {EXTRA_CONTACT_TYPES.map((item) => <option key={item} value={item}>{TYPE_LABEL[item]}</option>)}
          </select>
          <Input aria-label="Contact value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={PLACEHOLDER[type]} maxLength={300} autoFocus disabled={pending} />
          <Input aria-label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional), e.g. Clinic reception" maxLength={50} className="sm:col-start-2" disabled={pending} />
          <div className="flex justify-end gap-2 sm:col-start-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={pending || !value.trim()}>{pending ? 'Saving…' : 'Add'}</Button>
          </div>
        </form>
      )}
    </div>
  )
}

export function SourceLockNote() {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Lock className="size-3" />
      Email and phone from the lead source cannot be edited. Use “Add contact” for more.
    </p>
  )
}
