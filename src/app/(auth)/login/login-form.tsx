'use client'

import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FormMessage } from '@/components/shared/form-field'
import { api, ApiError } from '@/lib/client/api'
import { DEMO_MODE } from '@/lib/demo-mode'

const credentialsSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const challengeSchema = z.object({
  mfaToken: z.string().regex(/^(?:\d{6}|[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){2})$/, 'Enter a valid authenticator or recovery code'),
})

type Credentials = z.infer<typeof credentialsSchema>
type Challenge = z.infer<typeof challengeSchema>

interface LoginData {
  status: 'ok' | 'mfa_required'
}

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedNext = searchParams.get('next')
  const next = requestedNext && requestedNext.startsWith('/') && !requestedNext.startsWith('//') && !requestedNext.includes('\\')
    ? requestedNext
    : '/dashboard'
  const googleMfa = searchParams.get('google_mfa') === '1'
  const googleError = searchParams.get('google_error')

  const [challenge, setChallenge] = React.useState<Credentials | null>(null)
  const [recoveryMode, setRecoveryMode] = React.useState(false)

  const credentials = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) })
  const second = useForm<Challenge>({ resolver: zodResolver(challengeSchema) })

  if (DEMO_MODE) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Read-only demo</CardTitle>
          <CardDescription>
            No account or backend connection is needed. The workspace uses sample data and does not save changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/dashboard">Open demo workspace</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  function completeSession() {
    toast.success('Signed in')
    router.replace(next)
    router.refresh()
  }

  async function onSubmitCredentials(values: Credentials) {
    try {
      const data = await api.post<LoginData>('/api/auth/login', values)
      if (data.status === 'mfa_required') {
        setChallenge(values)
        setRecoveryMode(false)
        return
      }
      completeSession()
    } catch (error) {
      credentials.setError('root', { message: messageOf(error) })
    }
  }

  async function onSubmitChallenge(values: Challenge) {
    if (googleMfa) {
      try {
        const payload = recoveryMode ? { recoveryCode: values.mfaToken } : { mfaToken: values.mfaToken }
        const data = await api.post<{ status: 'ok'; next?: string }>('/api/auth/google/mfa', payload)
        toast.success('Signed in')
        router.replace(data.next || next)
        router.refresh()
      } catch (error) {
        second.setError('root', { message: messageOf(error) })
      }
      return
    }
    if (!challenge) return
    try {
      const payload = recoveryMode
        ? { ...challenge, recoveryCode: values.mfaToken }
        : { ...challenge, mfaToken: values.mfaToken }
      const data = await api.post<LoginData>('/api/auth/login', payload)
      if (data.status === 'mfa_required') {
        second.setError('root', { message: 'That code was not accepted. Try again.' })
        return
      }
      completeSession()
    } catch (error) {
      second.setError('root', { message: messageOf(error) })
    }
  }

  if (challenge || googleMfa) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{googleMfa ? 'Verify your identity' : 'Two-factor verification'}</CardTitle>
          <CardDescription>{googleMfa
            ? 'Enter the 6-digit code from your authenticator app to finish signing in.'
            : `Enter the 6-digit code from your authenticator app for ${challenge?.email}, or use a recovery code.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={second.handleSubmit(onSubmitChallenge)} className="space-y-4" noValidate>
            <FormMessage>{googleError ? googleErrorMessage(googleError) : second.formState.errors.root?.message}</FormMessage>

            <Field
              label={recoveryMode ? 'Recovery code' : 'Authentication code'}
              htmlFor="mfaToken"
              error={second.formState.errors.mfaToken?.message}
              hint={recoveryMode ? 'Recovery codes are single-use.' : undefined}
            >
              <Input
                id="mfaToken"
                inputMode={recoveryMode ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={recoveryMode ? 20 : 6}
                placeholder={recoveryMode ? 'XXXX-XXXX-XXXX' : '123456'}
                className="text-center tracking-[0.3em] tabular"
                aria-invalid={Boolean(second.formState.errors.mfaToken)}
                {...second.register('mfaToken')}
              />
            </Field>

            <Button type="submit" className="w-full" disabled={second.formState.isSubmitting}>
              {second.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Verify
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
                onClick={() => {
                  setChallenge(null)
                  setRecoveryMode(false)
                  second.clearErrors()
                }}
              >
                <ArrowLeft className="size-3.5" />
                Back
              </button>
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  setRecoveryMode(v => !v)
                  second.clearErrors()
                }}
              >
                {recoveryMode ? 'Use authenticator code' : 'Use a recovery code'}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Sign in with your Google account or email and password.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <a href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}>Continue with Google</a>
        </Button>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>OR</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <form onSubmit={credentials.handleSubmit(onSubmitCredentials)} className="space-y-4" noValidate>
          <FormMessage>{googleError ? googleErrorMessage(googleError) : credentials.formState.errors.root?.message}</FormMessage>

          <Field label="Email" htmlFor="email" error={credentials.formState.errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@practice.in"
              aria-invalid={Boolean(credentials.formState.errors.email)}
              {...credentials.register('email')}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            error={credentials.formState.errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(credentials.formState.errors.password)}
              {...credentials.register('password')}
            />
          </Field>

          <div className="flex justify-end text-sm">
            <Link href="/forgot-password" className="text-primary hover:underline">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={credentials.formState.isSubmitting}>
            {credentials.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>

        </form>
      </CardContent>
    </Card>
  )
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Unable to sign in. Please try again.'
}

function googleErrorMessage(error: string): string {
  if (error === 'unavailable') return 'Google sign-in is not configured. Contact your administrator.'
  if (error === 'access') return 'This Google account cannot access the CRM. Contact your administrator.'
  if (error === 'retry') return 'Too many sign-in attempts. Please wait and try again.'
  return 'Google sign-in could not be completed. Please try again.'
}
