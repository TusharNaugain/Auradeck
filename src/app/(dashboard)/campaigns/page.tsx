'use client'

import React from 'react'
import { AlertTriangle, Loader2, Megaphone, Send } from 'lucide-react'
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

type Audience = 'priority' | 'others' | 'all'
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
]
const STATUS: Record<Status, { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' }> = {
  queued: { label: 'Queued', variant: 'secondary' },
  syncing: { label: 'Preparing', variant: 'warning' },
  sending: { label: 'Sending', variant: 'warning' },
  sent: { label: 'Sent', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
}
const isActive = (s: Status) => s === 'queued' || s === 'syncing' || s === 'sending'
const audienceLabel = (id: Audience) => AUDIENCES.find((a) => a.id === id)?.label ?? id

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
        description="Send one message to a group of leads. Unsubscribe links and bounces are handled automatically."
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

function Composer() {
  const invalidate = useInvalidate()
  const [audience, setAudience] = React.useState<Audience>('priority')
  const [subject, setSubject] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [confirming, setConfirming] = React.useState(false)
  const [notConfigured, setNotConfigured] = React.useState(false)

  const counts = useQuery({
    queryKey: ['campaigns', 'audiences'],
    queryFn: () => api.get<Record<Audience, number>>('/api/campaigns/send/audiences'),
  })
  const count = counts.data?.[audience] ?? 0
  const ready = subject.trim() !== '' && message.trim() !== ''

  const [debounced, setDebounced] = React.useState(message)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(message), 400)
    return () => clearTimeout(timer)
  }, [message])
  const hasPreview = debounced.trim() !== ''
  const preview = useQuery({
    queryKey: ['campaign-preview', debounced],
    queryFn: () => api.post<{ html: string }>('/api/campaigns/send/preview', { message: debounced }),
    enabled: hasPreview,
    staleTime: Infinity,
  })

  const send = useMutation({
    mutationFn: (mode: Mode) =>
      api.post('/api/campaigns/send', {
        audience,
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
        const fresh = (await counts.refetch()).data?.[audience]
        return toast.error(`The audience changed and now has ${fresh ?? 'a different number of'} people. Review and send again.`)
      }
      toast.error(errorMessage(error))
    },
  })

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardContent className="space-y-5 pt-6">
          {notConfigured && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Email sending is not set up yet. Ask your admin to add the Resend API key.
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Audience</legend>
            {counts.isError && <p className="text-sm text-destructive">Could not load audience sizes.</p>}
            <div className="grid gap-2 sm:grid-cols-3">
              {AUDIENCES.map(({ id, label }) => {
                const n = counts.data?.[id]
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm',
                      'has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring'
                    )}
                  >
                    <input type="radio" name="audience" className="accent-primary" checked={audience === id} disabled={!n} onChange={() => setAudience(id)} />
                    {label}
                    {n !== undefined && <span className="text-muted-foreground">({n})</span>}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label htmlFor="campaign-subject">Subject</Label>
              <span className="text-xs text-muted-foreground">{subject.length}/150</span>
            </div>
            <Input id="campaign-subject" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label htmlFor="campaign-message">Message</Label>
              <span className="text-xs text-muted-foreground">{message.length}/10000</span>
            </div>
            <Textarea
              id="campaign-message"
              className="min-h-56"
              value={message}
              maxLength={10000}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby="campaign-hint"
            />
            <p id="campaign-hint" className="text-xs text-muted-foreground">Plain text. Leave a blank line between paragraphs.</p>
          </div>

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
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Preview</CardTitle>
          <CardDescription>Shown with sample values.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-96 flex-1">
          {hasPreview && preview.data ? (
            <iframe title="Email preview" sandbox="" srcDoc={preview.data.html} className="h-full min-h-96 w-full rounded-md border bg-white" />
          ) : hasPreview && preview.isFetching ? (
            <Skeleton className="h-full min-h-96 w-full" />
          ) : (
            <p className="text-sm text-muted-foreground">
              {preview.isError ? errorMessage(preview.error) : 'Start writing your message to see the email.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this campaign?</DialogTitle>
            <DialogDescription>
              {count} {count === 1 ? 'person' : 'people'} in &ldquo;{audienceLabel(audience)}&rdquo; will receive &ldquo;{subject.trim()}&rdquo;. This cannot be undone.
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
