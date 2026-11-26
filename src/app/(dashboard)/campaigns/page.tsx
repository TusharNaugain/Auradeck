'use client'

import React from 'react'
import { AlertTriangle, Link2, Loader2, Megaphone, Send, X } from 'lucide-react'
import { stageLabel } from '@/lib/leads/stages'
import { toast } from 'sonner'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'
import { api, ApiError } from '@/lib/client/api'
import { formatRelative } from '@/lib/client/format'
import { errorMessage, useHasPermission, useInvalidate, useSession } from '@/lib/client/hooks'
import { cn } from '@/lib/utils/cn'

type Audience = 'priority' | 'others' | 'all' | 'selected'
type GroupAudience = Exclude<Audience, 'selected'>
type PickableLead = { id: string; name: string; email: string; isPriority: boolean; lifecycleStage: string }
type Status = 'queued' | 'syncing' | 'sending' | 'sent' | 'failed'
type Mode = 'test' | 'send'

interface Send {
  id: string
  subject: string
  audience: Audience
  recipientCount: number
  status: Status
  error: string | null
  createdAt: string
  completedAt: string | null
}

const AUDIENCES: { id: Audience; label: string }[] = [
  { id: 'priority', label: 'Priority reachout' },
  { id: 'others', label: 'Others' },
  { id: 'all', label: 'Everyone' },
  { id: 'selected', label: 'Pick leads' },
]
const MAX_PICKED = 500
const STATUS: Record<Status, { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  syncing: { label: 'Preparing', variant: 'warning' },
  sending: { label: 'Sending', variant: 'warning' },
  sent: { label: 'Sent', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}
const FIELD = 'border-muted-foreground/40 bg-background'
/** Accepts "https://x", "www.x" or "x.com/..."; returns an http(s) URL safe for [text](url), or null. */
function normaliseLinkUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s || /\s/.test(s)) return null
  const url = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.')) return null
  } catch {
    return null
  }
  return url.replace(/[()<>"']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const SAMPLE_MESSAGE ='Your message will appear here.\n\nWrite it on the left and this preview updates as you type.'
const isActive = (s: Status) => s === 'queued' || s === 'syncing' || s === 'sending'
const audienceLabel = (id: Audience) => (id === 'selected' ? 'Hand-picked leads' : AUDIENCES.find((a) => a.id === id)?.label ?? id)

/** Search and tick individual leads. Lists only leads the server says this user may email. */
function LeadPicker({ picked, onChange }: { picked: PickableLead[]; onChange: (leads: PickableLead[]) => void }) {
  const [input, setInput] = React.useState('')
  const [search, setSearch] = React.useState('')
  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(input.trim()), 250)
    return () => clearTimeout(timer)
  }, [input])
  const results = useQuery({
    queryKey: ['campaigns', 'pickable-leads', search],
    queryFn: () => api.get<PickableLead[]>('/api/campaigns/send/leads', { search: search || undefined }),
    staleTime: 30_000,
  })
  const pickedIds = new Set(picked.map((lead) => lead.id))
  function toggle(lead: PickableLead) {
    if (pickedIds.has(lead.id)) return onChange(picked.filter((item) => item.id !== lead.id))
    if (picked.length >= MAX_PICKED) return toast.error(`You can pick up to ${MAX_PICKED} leads per send.`)
    onChange([...picked, lead])
  }

  return (
    <div className="space-y-2 rounded-md border border-muted-foreground/30 p-3">
      <Input
        className={FIELD}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Search leads by name, email or practice…"
        aria-label="Search leads to email"
      />
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Picked leads">
          {picked.map((lead) => (
            <Badge key={lead.id} variant="secondary" className="gap-1 pr-1 font-normal">
              {lead.name || lead.email}
              <button type="button" aria-label={`Remove ${lead.name || lead.email}`} onClick={() => toggle(lead)} className="rounded-full p-0.5 hover:bg-background">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange([])}>Clear all</button>
        </div>
      )}
      <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
        {results.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : results.isError ? (
          <p className="p-3 text-sm text-destructive">{errorMessage(results.error)}</p>
        ) : !results.data?.length ? (
          <p className="p-3 text-sm text-muted-foreground">{search ? 'No matching leads you can email.' : 'No leads you can email yet.'}</p>
        ) : (
          <ul>
            {results.data.map((lead) => (
              <li key={lead.id} className="border-b border-border/60 last:border-0">
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                  <input type="checkbox" className="accent-primary" checked={pickedIds.has(lead.id)} onChange={() => toggle(lead)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{lead.name || lead.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">{lead.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{stageLabel(lead.lifecycleStage)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Showing up to 50 matches — search to find others. Only leads you can see, with a valid email, not dead and not unsubscribed, are listed.
      </p>
    </div>
  )
}

export default function CampaignsPage() {
  const { data: session } = useSession()
  const canSend = useHasPermission('campaigns.send')

  if (!session) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        description="Send one message to a group of leads, or to leads you pick one by one. Unsubscribe links and bounces are handled automatically."
      />
      {canSend ? (
        <>
          <Composer />
          <History />
        </>
      ) : (
        <EmptyState
          icon={<Megaphone />}
          title="You do not have permission to send campaigns"
          description="Ask an admin to grant you the campaigns permission."
        />
      )}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Composer() {
  const invalidate = useInvalidate()
  const [audience, setAudience] = React.useState<Audience>('priority')
  const [subject, setSubject] = React.useState('')
  const [message, setMessage] = React.useState('')
  const messageRef = React.useRef<HTMLTextAreaElement>(null)
  const [linkDraft, setLinkDraft] = React.useState<{ text: string; url: string; start: number; end: number } | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [notConfigured, setNotConfigured] = React.useState(false)

  const [picked, setPicked] = React.useState<PickableLead[]>([])
  const counts = useQuery({
    queryKey: ['campaigns', 'audiences'],
    queryFn: () => api.get<Record<GroupAudience, number>>('/api/campaigns/send/audiences'),
  })
  const count = audience === 'selected' ? picked.length : counts.data?.[audience] ?? 0
  // If the chosen group is empty (e.g. nobody is Priority yet), switch to the first group that has people.
  React.useEffect(() => {
    const data = counts.data
    if (!data || audience === 'selected' || data[audience]) return
    const next = AUDIENCES.find(({ id }) => id !== 'selected' && data[id as GroupAudience] > 0)
    if (next) setAudience(next.id)
  }, [counts.data, audience])
  const ready = subject.trim() !== '' && message.trim() !== ''

  const [debounced, setDebounced] = React.useState(message)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(message), 400)
    return () => clearTimeout(timer)
  }, [message])
  const previewMessage = debounced.trim() || SAMPLE_MESSAGE
  const preview = useQuery({
    queryKey: ['campaign-preview', previewMessage],
    queryFn: () => api.post<{ html: string }>('/api/campaigns/send/preview', { message: previewMessage }),
    staleTime: Infinity,
  })

  const send = useMutation({
    mutationFn: (mode: Mode) =>
      api.post('/api/campaigns/send', {
        audience,
        ...(audience === 'selected' && { leadIds: picked.map((lead) => lead.id) }),
        subject: subject.trim(),
        message,
        mode,
        ...(mode === 'send' && { confirmCount: count }),
      }),
    onSuccess: (_, mode) => {
      setNotConfigured(false)
      if (mode === 'test') return toast.success('Test email sent to your inbox')
      setConfirming(false)
      setSubject('')
      setMessage('')
      setPicked([])
      toast.success('Campaign is on its way')
      invalidate(['campaigns'])
    },
    onError: async (error) => {
      const code = error instanceof ApiError ? error.code : ''
      if (code === 'EMAIL_NOT_CONFIGURED') return setNotConfigured(true)
      if (code === 'SEND_IN_PROGRESS') {
        setConfirming(false)
        return toast.error('A campaign is already being sent. Wait for it to finish.')
      }
      if (code === 'COUNT_CHANGED') {
        setConfirming(false)
        if (audience === 'selected') {
          return toast.error('Some picked leads can no longer be emailed (removed, unsubscribed, marked dead or no longer visible to you). Re-pick and send again.')
        }
        const fresh = (await counts.refetch()).data?.[audience]
        return toast.error(`The audience changed and now has ${fresh ?? 'a different number of'} people. Review and send again.`)
      }
      toast.error(errorMessage(error))
    },
  })

  return (
    <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
      <Card>
        <CardContent className="space-y-7 pt-6">
          {notConfigured && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Email sending is not set up yet. Ask your admin to add the Resend API key.
            </div>
          )}

          <Step n={1} title="Who should get this email?">
            {counts.isError && <p className="text-sm text-destructive">Could not load audience sizes.</p>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AUDIENCES.map(({ id, label }) => {
                const n = id === 'selected' ? undefined : counts.data?.[id]
                const disabled = id !== 'selected' && !n
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-muted-foreground/40 p-3 text-sm',
                      'has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring'
                    )}
                  >
                    <input type="radio" name="audience" className="accent-primary" checked={audience === id} disabled={disabled} onChange={() => setAudience(id)} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {n !== undefined && <span className="shrink-0 text-muted-foreground">({n})</span>}
                    {id === 'selected' && picked.length > 0 && <span className="shrink-0 text-muted-foreground">({picked.length})</span>}
                  </label>
                )
              })}
            </div>
            {audience === 'selected' && <LeadPicker picked={picked} onChange={setPicked} />}
            <p className="text-xs text-muted-foreground">
              Only leads with a valid email are counted. Dead, archived and unsubscribed leads are left out automatically.
            </p>
          </Step>

          <Step n={2} title="Write your email">
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <Label htmlFor="campaign-subject">Subject</Label>
                <span className="text-xs text-muted-foreground">{subject.length}/150</span>
              </div>
              <Input
                id="campaign-subject"
                className={FIELD}
                value={subject}
                maxLength={150}
                placeholder="e.g. A quick hello from Auradeck"
                onChange={(e) => setSubject(e.target.value)}
                aria-describedby="campaign-subject-hint"
              />
              <p id="campaign-subject-hint" className="text-xs text-muted-foreground">
                This is the headline people see in their inbox before they open the email. Keep it short.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="campaign-message">Message</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const el = messageRef.current
                      const start = el?.selectionStart ?? message.length
                      const end = el?.selectionEnd ?? message.length
                      setLinkDraft({ text: message.slice(start, end).trim(), url: '', start, end })
                    }}
                  >
                    <Link2 />
                    Add link
                  </Button>
                  <span className="text-xs text-muted-foreground">{message.length}/10000</span>
                </div>
              </div>
              <Textarea
                ref={messageRef}
                id="campaign-message"
                className={cn('min-h-56', FIELD)}
                value={message}
                maxLength={10000}
                placeholder={'Write what you want to tell them.\n\nLeave a blank line between paragraphs.'}
                onChange={(e) => setMessage(e.target.value)}
                aria-describedby="campaign-hint"
              />
              <p id="campaign-hint" className="text-xs text-muted-foreground">
                Write your own greeting. To put a link behind words, select the words and click <span className="font-medium text-foreground">Add link</span>; it shows up as [words](link) here and as a clean clickable link in the email. An Unsubscribe link is added at the bottom automatically.
              </p>
            </div>
          </Step>

          <Step n={3} title="Check, then send">
            <p className="text-sm text-muted-foreground">
              Click <span className="font-medium text-foreground">Send test to me</span> first. It goes only to your own email so you can see exactly how it looks.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!ready || send.isPending} onClick={() => send.mutate('test')}>
                {send.isPending && send.variables === 'test' && <Loader2 className="animate-spin" />}
                Send test to me
              </Button>
              <Button disabled={!ready || count === 0 || send.isPending} onClick={() => setConfirming(true)}>
                <Send />
                Send to {count} {count === 1 ? 'person' : 'people'}
              </Button>
            </div>
            {!ready && <p className="text-xs text-muted-foreground">Add a subject and a message to turn these buttons on.</p>}
          </Step>
        </CardContent>
      </Card>

      <Card className="flex flex-col xl:sticky xl:top-4">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Preview</CardTitle>
          <CardDescription>
            This is how the email will look. Links here are not clickable; use Send test to me to try them.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-96 flex-1">
          {preview.data ? (
            <iframe title="Email preview" sandbox="" srcDoc={preview.data.html} className="h-full min-h-96 w-full rounded-md border bg-white" />
          ) : preview.isError ? (
            <p className="text-sm text-muted-foreground">{errorMessage(preview.error)}</p>
          ) : (
            <Skeleton className="h-full min-h-96 w-full" />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!linkDraft} onOpenChange={(open) => !open && setLinkDraft(null)}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!linkDraft) return
              const url = normaliseLinkUrl(linkDraft.url)
              const text = linkDraft.text.replace(/[[\]\n]/g, ' ').trim()
              if (!url) return toast.error('Enter a full web address, for example https://linkedin.com/in/you')
              if (!text) return toast.error('Enter the words people should click')
              const md = `[${text}](${url})`
              const next = message.slice(0, linkDraft.start) + md + message.slice(linkDraft.end)
              if (next.length > 10000) return toast.error('The message would be longer than 10000 characters')
              setMessage(next)
              setLinkDraft(null)
              const caret = linkDraft.start + md.length
              requestAnimationFrame(() => {
                messageRef.current?.focus()
                messageRef.current?.setSelectionRange(caret, caret)
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a link</DialogTitle>
              <DialogDescription>People see only the words; the long address stays hidden behind them.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="link-text">Words to click</Label>
              <Input
                id="link-text"
                className={FIELD}
                value={linkDraft?.text ?? ''}
                placeholder="e.g. Join with your personal invite"
                onChange={(e) => setLinkDraft((d) => d && { ...d, text: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-url">Link</Label>
              <Input
                id="link-url"
                className={FIELD}
                value={linkDraft?.url ?? ''}
                placeholder="https://..."
                autoFocus
                onChange={(e) => setLinkDraft((d) => d && { ...d, url: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkDraft(null)}>Cancel</Button>
              <Button type="submit">Insert link</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this campaign?</DialogTitle>
            <DialogDescription>
              {count} {count === 1 ? 'person' : 'people'} {audience === 'selected' ? '(hand-picked leads)' : <>in &ldquo;{audienceLabel(audience)}&rdquo;</>} will receive &ldquo;{subject.trim()}&rdquo;. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button disabled={send.isPending} onClick={() => send.mutate('send')}>
              {send.isPending && <Loader2 className="animate-spin" />}
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function History() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['campaigns', 'history'],
    queryFn: () => api.get<Send[]>('/api/campaigns/send'),
    refetchInterval: (query) => (query.state.data?.some((row) => isActive(row.status)) ? 3000 : false),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Recent sends</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <EmptyState title="Could not load recent sends" description={errorMessage(error)} />
        ) : !data?.length ? (
          <EmptyState icon={<Megaphone />} title="No campaigns yet" description="Campaigns you send will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-64 truncate font-medium">{row.subject}</TableCell>
                    <TableCell>{audienceLabel(row.audience)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.recipientCount}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                      {row.status === 'failed' && row.error && <p className="mt-1 max-w-64 text-xs text-destructive">{row.error}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(row.completedAt ?? row.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
