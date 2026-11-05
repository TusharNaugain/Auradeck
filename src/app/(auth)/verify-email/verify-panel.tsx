'use client'

import React from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { api, ApiError } from '@/lib/client/api'

export function VerifyPanel({ token }: { token: string }) {
  const [state, setState] = React.useState<{ status: 'pending' | 'verifying' | 'done' | 'failed'; message: string }>({
    status: token ? 'verifying' : 'failed',
    message: 'This verification link is invalid or has already expired.',
  })

  React.useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        await api.post('/api/auth/verify-email', { token })
        if (!cancelled) setState({ status: 'done', message: 'Your email is confirmed. Sign in to set up your workspace.' })
      } catch (error) {
        if (cancelled) return
        setState({
          status: 'failed',
          message: error instanceof ApiError ? error.message : 'Verification failed. Request a new link.',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const verified = state.status === 'done'
  const busy = state.status === 'verifying'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {busy ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : verified ? (
            <CheckCircle2 className="size-5 text-emerald-600" />
          ) : (
            <ShieldAlert className="size-5 text-destructive" />
          )}
          {busy ? 'Verifying…' : verified ? 'Email verified' : 'Verification failed'}
        </CardTitle>
        <CardDescription>{state.message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button asChild className="w-full" disabled={busy}>
          <Link href="/login">Go to sign in</Link>
        </Button>
        {!busy && !verified && (
          <Button asChild variant="outline" className="w-full">
            <Link href="/forgot-password">Send me a new link</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
