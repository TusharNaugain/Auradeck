'use client'

/**
 * Plans & billing for a therapist practice: trial status, plan comparison,
 * Razorpay Checkout, result states, current plan and payment history.
 * Paid access is granted by the server only after Razorpay data is verified.
 */

import React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, RefreshCcw, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/client/api'
import { errorMessage, useHasPermission } from '@/lib/client/hooks'
import { formatCurrency, formatDate } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'

type Interval = 'monthly' | 'annual'
type AccessReason = 'active' | 'trial' | 'grace' | 'paid_period' | 'trial_expired' | 'payment_failed' | 'ended'

interface PlanOption {
  id: string
  name: string
  description: string | null
  monthlyPrice: number
  annualPrice: number | null
  currency: string
  features: string[]
}

interface SubscriptionView {
  status: string
  planId: string | null
  planName: string | null
  billingInterval: Interval | null
  amount: number | null
  currency: string
  trialEndsAt: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  graceUntil: string | null
  cancelAtPeriodEnd: boolean
  cancelledAt: string | null
  entitlement: { hasAccess: boolean; reason: AccessReason; until: string | null }
  canCheckout: boolean
}

interface PaymentRow {
  id: string
  razorpayPaymentId: string
  amount: number
  currency: string
  status: string
  method: string | null
  failureReason: string | null
  paidAt: string | null
  createdAt: string
}

type BillingStatus =
  | { enabled: boolean; configured: boolean; mode: 'test' | 'live' | null; eligible: false }
  | {
      enabled: boolean
      configured: boolean
      mode: 'test' | 'live' | null
      eligible: true
      subscription: SubscriptionView | null
      plans: PlanOption[]
      payments: PaymentRow[]
    }

interface CheckoutStart {
  keyId: string
  mode: 'test' | 'live'
  subscriptionId: string
  planName: string
  interval: Interval
  amount: number
  currency: string
  practiceName: string
  prefill: { name?: string; email?: string; contact?: string }
}

interface RazorpaySuccess {
  razorpay_payment_id: string
  razorpay_subscription_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open: () => void
  on: (event: 'payment.failed', handler: (resp: { error?: { description?: string } }) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

type FlowState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'verifying' }
  | { kind: 'success'; confirmed: boolean }
  | { kind: 'failed'; message: string }

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

function loadCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (window.Razorpay) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Could not load Razorpay. Check your connection and try again.')), { once: true })
    if (!existing) {
      script.src = CHECKOUT_SRC
      script.async = true
      document.body.appendChild(script)
    }
  })
}

const STATUS_LABEL: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'default' }> = {
  TRIAL: { label: 'Free trial', variant: 'default' },
  CREATED: { label: 'Checkout started', variant: 'secondary' },
  AUTHENTICATED: { label: 'Activating', variant: 'default' },
  ACTIVE: { label: 'Active', variant: 'success' },
  PAST_DUE: { label: 'Payment due', variant: 'warning' },
  HALTED: { label: 'Payment failed', variant: 'destructive' },
  PAUSED: { label: 'Paused', variant: 'secondary' },
  CANCELLED: { label: 'Cancelled', variant: 'secondary' },
  COMPLETED: { label: 'Completed', variant: 'secondary' },
  EXPIRED: { label: 'Expired', variant: 'secondary' },
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
}

export default function PlanBillingPage() {
  const canManage = useHasPermission('billing.manage')
  const [interval, setBillingInterval] = React.useState<Interval>('monthly')
  const [flow, setFlow] = React.useState<FlowState>({ kind: 'idle' })
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)

  const status = useQuery({
    queryKey: ['billing-plan'],
    queryFn: () => api.get<BillingStatus>('/api/billing/plan'),
    // After a payment, poll until the server confirms the plan from Razorpay.
    refetchInterval: (query) => {
      const data = query.state.data
      if (flow.kind !== 'success' || flow.confirmed || !data || !data.eligible) return false
      return 3000
    },
  })

  const data = status.data
  const sub = data && data.eligible ? data.subscription : null

  React.useEffect(() => {
    if (flow.kind === 'success' && !flow.confirmed && sub && sub.entitlement.reason === 'active') {
      setFlow({ kind: 'success', confirmed: true })
    }
  }, [flow, sub])

  async function subscribe(plan: PlanOption) {
    setFlow({ kind: 'starting' })
    try {
      await loadCheckoutScript()
      const start = await api.post<CheckoutStart>('/api/billing/plan/checkout', { planId: plan.id, interval })
      if (!window.Razorpay) throw new Error('Razorpay checkout did not load')

      const rzp = new window.Razorpay({
        key: start.keyId,
        subscription_id: start.subscriptionId,
        name: 'Auradeck',
        description: `${start.planName} · ${start.interval === 'annual' ? 'Yearly' : 'Monthly'}`,
        prefill: start.prefill,
        notes: { practice: start.practiceName },
        theme: { color: '#4f46e5' },
        modal: {
          ondismiss: () => setFlow((f) => (f.kind === 'starting' ? { kind: 'idle' } : f)),
        },
        handler: async (resp: RazorpaySuccess) => {
          setFlow({ kind: 'verifying' })
          try {
            const result = await api.post<{ verified: boolean; subscription: SubscriptionView }>('/api/billing/plan/checkout/verify', {
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySubscriptionId: resp.razorpay_subscription_id,
              razorpaySignature: resp.razorpay_signature,
            })
            setFlow({ kind: 'success', confirmed: result.subscription.entitlement.reason === 'active' })
          } catch (error) {
            // Payment may still have gone through; the webhook will confirm it.
            setFlow({ kind: 'failed', message: errorMessage(error) })
          } finally {
            void status.refetch()
          }
        },
      })
      rzp.on('payment.failed', (resp) => {
        setFlow({ kind: 'failed', message: resp.error?.description ?? 'The payment did not go through.' })
      })
      rzp.open()
    } catch (error) {
      setFlow({ kind: 'failed', message: errorMessage(error) })
    }
  }

  async function cancelPlan() {
    setCancelling(true)
    try {
      await api.post('/api/billing/plan/cancel')
      toast.success('Your plan is cancelled. You keep access until the end of the paid period.')
      setConfirmCancel(false)
      void status.refetch()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setCancelling(false)
    }
  }

  if (status.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (status.isError || !data) {
    return (
      <div className="space-y-5">
        <PageHeader title="Plans & billing" />
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-6">
            <p className="text-sm text-muted-foreground">{errorMessage(status.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void status.refetch()}>
              <RefreshCcw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data.eligible) {
    return (
      <div className="space-y-5">
        <PageHeader title="Plans & billing" description="Auradeck plans are bought by therapist practices." />
        <Card>
          <CardContent className="space-y-3 py-6 text-sm">
            <p>The Auradeck team workspace does not need a plan.</p>
            <Link href="/billing" className="font-medium text-primary hover:underline">
              See practice subscriptions →
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data.enabled || !sub) {
    return (
      <div className="space-y-5">
        <PageHeader title="Plans & billing" description="Your Auradeck plan and payments." />
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            You&apos;re on the free beta. Paid plans will appear here soon — nothing to do for now.
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusInfo = STATUS_LABEL[sub.status] ?? { label: sub.status, variant: 'secondary' as const }
  const trialDays = daysLeft(sub.trialEndsAt)
  const showPlans = sub.canCheckout
  const busy = flow.kind === 'starting' || flow.kind === 'verifying'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Plans & billing"
        description="Your Auradeck plan, billing dates and payments."
        actions={data.mode === 'test' ? <Badge variant="warning">Razorpay test mode</Badge> : undefined}
      />

      <AccessBanner sub={sub} trialDays={trialDays} />
      <FlowBanner flow={flow} onDismiss={() => setFlow({ kind: 'idle' })} />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Current plan</CardTitle>
            <CardDescription>{sub.planName && sub.status !== 'TRIAL' ? sub.planName : 'Free trial'}</CardDescription>
          </div>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          {sub.status === 'TRIAL' || sub.status === 'CREATED' ? (
            <Fact label="Trial ends" value={sub.trialEndsAt ? formatDate(sub.trialEndsAt) : '—'} />
          ) : (
            <>
              <Fact
                label="Price"
                value={sub.amount != null ? `${formatCurrency(sub.amount)} / ${sub.billingInterval === 'annual' ? 'year' : 'month'}` : '—'}
              />
              <Fact
                label={sub.cancelAtPeriodEnd || sub.status === 'CANCELLED' ? 'Access until' : 'Next billing date'}
                value={sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : '—'}
              />
              <Fact label="Billing period started" value={sub.currentPeriodStart ? formatDate(sub.currentPeriodStart) : '—'} />
            </>
          )}
        </CardContent>
        {canManage && ['ACTIVE', 'AUTHENTICATED', 'PAST_DUE'].includes(sub.status) && !sub.cancelAtPeriodEnd && (
          <CardContent className="border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
              Cancel plan
            </Button>
          </CardContent>
        )}
      </Card>

      {showPlans && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Choose a plan</h2>
            <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-sm" role="tablist" aria-label="Billing period">
              {(['monthly', 'annual'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={interval === value}
                  onClick={() => setBillingInterval(value)}
                  className={cn(
                    'rounded-md px-3 py-1.5 font-medium transition-colors',
                    interval === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {value === 'monthly' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.plans.map((plan) => {
              const price = interval === 'annual' ? plan.annualPrice : plan.monthlyPrice
              const saving = plan.annualPrice ? Math.round(plan.monthlyPrice * 12 - plan.annualPrice) : 0
              return (
                <Card key={plan.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {plan.description && <CardDescription>{plan.description}</CardDescription>}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    {price == null ? (
                      <p className="text-sm text-muted-foreground">Only available monthly.</p>
                    ) : (
                      <div>
                        <span className="text-2xl font-semibold">{formatCurrency(price)}</span>
                        <span className="text-sm text-muted-foreground"> / {interval === 'annual' ? 'year' : 'month'}</span>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Includes GST{interval === 'annual' && saving > 0 ? ` · save ${formatCurrency(saving)} a year` : ''}
                        </p>
                      </div>
                    )}
                    <ul className="space-y-1.5 text-sm">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex gap-2">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-health-healthy" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto">
                      {canManage ? (
                        <Button className="w-full" disabled={busy || price == null || !data.configured} onClick={() => void subscribe(plan)}>
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                          {sub.status === 'TRIAL' || sub.status === 'CREATED' ? 'Subscribe' : 'Subscribe again'}
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">Ask your practice owner to choose a plan.</p>
                      )}
                      {!data.configured && canManage && (
                        <p className="mt-2 text-xs text-destructive">Online payments are not configured yet.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Payments are processed securely by Razorpay. The plan renews automatically until you cancel.
          </p>
        </section>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment history</CardTitle>
        </CardHeader>
        <CardContent>
          {data.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 pr-4 font-medium">Amount</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="hidden py-2 pr-4 font-medium sm:table-cell">Method</th>
                    <th className="hidden py-2 font-medium md:table-cell">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="py-2 pr-4">{formatDate(p.paidAt ?? p.createdAt)}</td>
                      <td className="py-2 pr-4">{formatCurrency(p.amount)}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={p.status === 'captured' ? 'success' : p.status === 'failed' ? 'destructive' : 'secondary'}>
                          {p.status === 'captured' ? 'Paid' : p.status === 'failed' ? 'Failed' : p.status}
                        </Badge>
                        {p.failureReason && <div className="mt-0.5 text-xs text-muted-foreground">{p.failureReason}</div>}
                      </td>
                      <td className="hidden py-2 pr-4 capitalize sm:table-cell">{p.method ?? '—'}</td>
                      <td className="hidden py-2 font-mono text-xs text-muted-foreground md:table-cell">{p.razorpayPaymentId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel your plan?</DialogTitle>
            <DialogDescription>
              {sub.status === 'ACTIVE' && sub.currentPeriodEnd
                ? `You won't be charged again. You keep full access until ${formatDate(sub.currentPeriodEnd)}.`
                : 'Your plan stops now and the workspace becomes read-only.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)} disabled={cancelling}>
              Keep plan
            </Button>
            <Button variant="destructive" onClick={() => void cancelPlan()} disabled={cancelling}>
              {cancelling && <Loader2 className="size-4 animate-spin" />} Cancel plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  )
}

function AccessBanner({ sub, trialDays }: { sub: SubscriptionView; trialDays: number | null }) {
  const { reason, until } = sub.entitlement
  let tone: 'info' | 'warn' | 'error' | null = null
  let text = ''
  if (reason === 'trial' && trialDays != null) {
    tone = trialDays <= 3 ? 'warn' : 'info'
    text = trialDays === 0 ? 'Your free trial ends today. Choose a plan to keep going.' : `Your free trial ends in ${trialDays} day${trialDays === 1 ? '' : 's'}.`
  } else if (reason === 'trial_expired') {
    tone = 'error'
    text = 'Your free trial has ended. Your data is safe, but the workspace is read-only until you choose a plan.'
  } else if (reason === 'grace') {
    tone = 'warn'
    text = `We couldn't charge your last renewal. Razorpay will retry automatically; access continues until ${until ? formatDate(until) : 'soon'}.`
  } else if (reason === 'payment_failed') {
    tone = 'error'
    text = 'Renewal payments failed, so the workspace is read-only. Subscribe again to restore access.'
  } else if (reason === 'paid_period' || (reason === 'active' && sub.cancelAtPeriodEnd)) {
    tone = 'info'
    text = `Your plan is cancelled. Access continues until ${until ? formatDate(until) : 'the end of the paid period'}.`
  } else if (reason === 'ended') {
    tone = 'error'
    text = 'Your plan has ended. The workspace is read-only until you subscribe again.'
  }
  if (!tone) return null
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-4 py-3 text-sm',
        tone === 'info' && 'border-primary/20 bg-primary/5',
        tone === 'warn' && 'border-health-watch/30 bg-health-watch/10',
        tone === 'error' && 'border-destructive/30 bg-destructive/5'
      )}
    >
      <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', tone === 'error' ? 'text-destructive' : tone === 'warn' ? 'text-health-watch' : 'text-primary')} />
      <span>{text}</span>
    </div>
  )
}

function FlowBanner({ flow, onDismiss }: { flow: FlowState; onDismiss: () => void }) {
  if (flow.kind === 'idle' || flow.kind === 'starting') return null
  if (flow.kind === 'verifying') {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
        <Loader2 className="size-4 animate-spin" /> Confirming your payment with Razorpay…
      </div>
    )
  }
  if (flow.kind === 'success') {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-health-healthy/30 bg-health-healthy/10 px-4 py-3 text-sm">
        <span className="flex items-start gap-2">
          {flow.confirmed ? <CheckCircle2 className="mt-0.5 size-4 text-health-healthy" /> : <Loader2 className="mt-0.5 size-4 animate-spin" />}
          {flow.confirmed
            ? 'Payment received — your plan is active. Thank you!'
            : 'Payment received. Activating your plan — this usually takes a few seconds. You can safely leave this page.'}
        </span>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <span className="flex items-start gap-2">
        <XCircle className="mt-0.5 size-4 text-destructive" />
        <span>
          {flow.message} No money is taken for a failed payment; if you were charged, it will show here within a few minutes. You can try again.
        </span>
      </span>
      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}
