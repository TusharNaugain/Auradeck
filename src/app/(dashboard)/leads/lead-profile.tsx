'use client'

import * as React from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { enumLabel, formatDate, formatRelative } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import { stageTitle } from '@/lib/leads/stages'
import {
  DEMO_STATUSES, OUTCOMES, PAYMENT_STATUSES, WILLINGNESS_TO_PAY, optionLabel,
} from '@/lib/leads/profile'
import { useLeadSaver } from './lead-panels'

export interface TherapistRecordLead {
  id: string
  fullName: string
  email: string | null
  phoneNumber?: string | null
  jobTitle?: string | null
  leadSource: string
  sourceDetail?: string | null
  lifecycleStage: string
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  nextAction?: string | null
  painPoints?: string | null
  customFields?: Record<string, unknown> | null
  signedUpAt?: string | null
  demoStatus?: string | null
  demoAt?: string | null
  firstLoginAt?: string | null
  firstClientAt?: string | null
  firstSessionAt?: string | null
  lastActiveAt?: string | null
  trialStartAt?: string | null
  trialEndsAt?: string | null
  planOffered?: string | null
  willingnessToPay?: string | null
  paymentStatus?: string | null
  objections?: string | null
  featureRequests?: string | null
  outcome?: string | null
  lostReason?: string | null
}

type Kind =
  | { type: 'text'; maxLength: number; placeholder: string }
  | { type: 'textarea'; placeholder: string }
  | { type: 'date' }
  | { type: 'select'; options: readonly string[] }

/** One therapist = one record: everything the team knows about them, by category. */
export function TherapistRecord({ lead, canUpdate, owner }: { lead: TherapistRecordLead; canUpdate: boolean; owner: React.ReactNode }) {
  const { save } = useLeadSaver(lead.id)
  const field = (name: keyof TherapistRecordLead & string, label: string, kind: Kind, wide = false) => (
    <EditableField
      key={name}
      label={label}
      value={(lead[name] as string | null | undefined) ?? null}
      kind={kind}
      wide={wide}
      canUpdate={canUpdate}
      onSave={(value) => save({ [name]: value }, `${label} saved`)}
    />
  )
  const sheetSource = typeof lead.customFields?.waitlistSource === 'string' ? lead.customFields.waitlistSource : null
  const source = [enumLabel(lead.leadSource), lead.sourceDetail || sheetSource].filter(Boolean).join(' · ')
  const trialHint = trialStatus(lead.trialEndsAt)

  return (
    <section className="rounded-xl border border-border/70 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Therapist record</p>
        <p className="text-[11px] text-muted-foreground">One therapist = one record</p>
      </div>
      <div className="mt-2 divide-y divide-border/60">
        <Category title="Identity">
          <ReadField label="Name" value={lead.fullName} />
          <ReadField label="Email" value={lead.email} />
          <ReadField label="Phone" value={lead.phoneNumber} />
          {field('jobTitle', 'Role / practice type', { type: 'text', maxLength: 100, placeholder: 'e.g. Psychologist, clinic owner' })}
        </Category>
        <Category title="Acquisition">
          <ReadField label="Lead source" value={source} />
          {field('signedUpAt', 'Signup date', { type: 'date' })}
        </Category>
        <Category title="Ownership">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Assigned team member</p>
            <div className="mt-0.5">{owner}</div>
          </div>
        </Category>
        <Category title="Sales">
          <ReadField label="Pipeline stage" value={stageTitle(lead.lifecycleStage)} hint="Change it in the Stage box above" />
          {field('demoStatus', 'Demo status', { type: 'select', options: DEMO_STATUSES })}
          {field('demoAt', 'Demo date', { type: 'date' })}
        </Category>
        <Category title="Product usage">
          {field('firstLoginAt', 'First login', { type: 'date' })}
          {field('firstClientAt', 'First client added', { type: 'date' })}
          {field('firstSessionAt', 'First session', { type: 'date' })}
          {field('lastActiveAt', 'Last active', { type: 'date' })}
        </Category>
        <Category title="Communication">
          <ReadField
            label="Last contacted"
            value={lead.lastContactedAt ? `${formatDate(lead.lastContactedAt)} · ${formatRelative(lead.lastContactedAt)}` : null}
            hint="Updates when you log an interaction"
          />
          <ReadField label="Next follow-up" value={lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : null} hint="Set it in Next follow-up date below" />
          {field('nextAction', 'Next action', { type: 'text', maxLength: 200, placeholder: 'e.g. Send demo reminder' }, true)}
        </Category>
        <Category title="Trial">
          {field('trialStartAt', 'Start date', { type: 'date' })}
          <div className="min-w-0">
            {field('trialEndsAt', 'Expiry date', { type: 'date' })}
            {trialHint && <p className={cn('text-[11px]', trialHint.expired ? 'text-destructive' : 'text-muted-foreground')}>{trialHint.text}</p>}
          </div>
        </Category>
        <Category title="Conversion">
          {field('planOffered', 'Plan offered', { type: 'text', maxLength: 100, placeholder: 'e.g. Solo – ₹999/month' })}
          {field('willingnessToPay', 'Willingness to pay', { type: 'select', options: WILLINGNESS_TO_PAY })}
          {field('paymentStatus', 'Payment status', { type: 'select', options: PAYMENT_STATUSES })}
        </Category>
        <Category title="Feedback">
          {field('painPoints', 'Pain points', { type: 'textarea', placeholder: 'What is hard for them today?' }, true)}
          {field('objections', 'Objections', { type: 'textarea', placeholder: 'What is stopping them?' }, true)}
          {field('featureRequests', 'Feature requests', { type: 'textarea', placeholder: 'What did they ask for?' }, true)}
        </Category>
        <Category title="Outcome">
          {field('outcome', 'Outcome', { type: 'select', options: OUTCOMES })}
          {field('lostReason', 'Reason for leaving', { type: 'text', maxLength: 500, placeholder: 'Why they left or said no' })}
        </Category>
      </div>
    </section>
  )
}

function trialStatus(endsAt: string | null | undefined) {
  if (!endsAt) return null
  const days = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { expired: true, text: `Expired ${-days} day${days === -1 ? '' : 's'} ago` }
  if (days === 0) return { expired: true, text: 'Expires today' }
  return { expired: false, text: `${days} day${days === 1 ? '' : 's'} left` }
}

function Category({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[120px_1fr]">
      <p className="pt-0.5 text-sm font-semibold">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function ReadField({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 break-words text-sm font-medium', !value && 'font-normal text-muted-foreground')}>{value || '—'}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** ISO date-time → yyyy-mm-dd in the viewer's time zone, for <input type="date">. */
function toDateInput(value: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function display(kind: Kind, value: string | null) {
  if (!value) return null
  if (kind.type === 'date') return formatDate(value)
  if (kind.type === 'select') return optionLabel(value)
  return value
}

function EditableField({
  label, value, kind, wide, canUpdate, onSave,
}: {
  label: string
  value: string | null
  kind: Kind
  wide?: boolean
  canUpdate: boolean
  onSave: (value: string | null) => Promise<boolean>
}) {
  const initial = kind.type === 'date' ? toDateInput(value) : value ?? ''
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(initial)
  const [pending, setPending] = React.useState(false)
  React.useEffect(() => { setDraft(initial); setEditing(false) }, [initial])

  const commit = (next: string) => {
    setPending(true)
    void onSave(next.trim() || null).then((ok) => { setPending(false); if (ok) setEditing(false) })
  }
  const shown = display(kind, value)

  if (kind.type === 'select') {
    return (
      <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
        <label className="text-xs text-muted-foreground">
          {label}
          <select
            value={value ?? ''}
            disabled={!canUpdate || pending}
            onChange={(e) => commit(e.target.value)}
            className={cn('mt-1 block h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground', !value && 'text-muted-foreground')}
          >
            <option value="">—</option>
            {kind.options.map((o) => <option key={o} value={o}>{optionLabel(o)}</option>)}
          </select>
        </label>
      </div>
    )
  }

  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      {editing ? (
        <form
          className={cn('mt-1 flex gap-1.5', kind.type === 'textarea' && 'flex-col')}
          onSubmit={(e) => { e.preventDefault(); commit(draft) }}
        >
          {kind.type === 'textarea' ? (
            <Textarea aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={kind.placeholder} maxLength={5000} className="min-h-20" autoFocus disabled={pending} />
          ) : (
            <Input
              aria-label={label}
              type={kind.type === 'date' ? 'date' : 'text'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={kind.type === 'text' ? kind.maxLength : undefined}
              placeholder={kind.type === 'text' ? kind.placeholder : undefined}
              className="h-8"
              autoFocus
              disabled={pending}
            />
          )}
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" className="h-8 px-2" aria-label={`Save ${label}`} disabled={pending}><Check className="size-4" /></Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label="Cancel" onClick={() => { setDraft(initial); setEditing(false) }} disabled={pending}><X className="size-4" /></Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          disabled={!canUpdate}
          onClick={() => setEditing(true)}
          className={cn('mt-0.5 flex max-w-full items-start gap-1.5 text-left text-sm font-medium', canUpdate && 'hover:underline')}
        >
          <span className={cn(kind.type === 'textarea' ? 'whitespace-pre-wrap break-words' : 'truncate', !shown && 'font-normal text-muted-foreground')}>
            {shown || (canUpdate ? (kind.type === 'date' ? 'Add date' : 'placeholder' in kind ? kind.placeholder : 'Add') : '—')}
          </span>
          {canUpdate && <Pencil className="mt-1 size-3 shrink-0 text-muted-foreground" />}
        </button>
      )}
    </div>
  )
}
