'use client'

import React from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FormMessage } from '@/components/shared/form-field'
import { api, ApiError } from '@/lib/client/api'

const existingUserSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm this invitation'),
})

const newUserSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(100),
    password: z.string().min(8, 'At least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  .refine(v => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

const PASSWORD_HINT =
  'At least 8 characters with an uppercase letter, a lowercase letter, a number and a special character.'

/**
 * Invitation links carry only a token, so we cannot know client-side whether the
 * address already has an account. Accept both shapes in one form: full name is
 * optional, which routes the request to the set-up path for brand-new teammates.
 */
export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter()
  const [hasAccount, setHasAccount] = React.useState(false)
  const [invalid, setInvalid] = React.useState(token.length === 0)
  const [error, setError] = React.useState('')

  const newUser = useForm<z.infer<typeof newUserSchema>>({ resolver: zodResolver(newUserSchema) })
  const existing = useForm<z.infer<typeof existingUserSchema>>({ resolver: zodResolver(existingUserSchema) })

  async function submitNewUser(values: z.infer<typeof newUserSchema>) {
    await send({ token, fullName: values.fullName, password: values.password })
  }

  async function send(payload: Record<string, unknown>) {
    setError('')
    try {
      await api.post('/api/auth/accept-invite', payload)
      router.replace('/login?next=/dashboard')
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && ['INVITATION_INVALID', 'INVITATION_EXPIRED'].includes(err.code)) {
        setInvalid(true)
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not accept this invitation.')
    }
  }

  if (invalid) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            Invitation not usable
          </CardTitle>
          <CardDescription>
            This invitation link is incomplete, has already been used, or has expired. Ask your
            administrator to send a fresh one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join your team</CardTitle>
        <CardDescription>
          Accept this invitation to get access to the workspace. Set a password to finish.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormMessage>{error}</FormMessage>

        <div className="flex gap-2 rounded-md border bg-muted/40 p-1 text-sm">
          {[
            { label: 'I am new here', value: false },
            { label: 'I already have an account', value: true },
          ].map(option => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setHasAccount(option.value)
                setError('')
              }}
              className={
                hasAccount === option.value
                  ? 'flex-1 rounded bg-background px-2 py-1 font-medium shadow-sm'
                  : 'flex-1 rounded px-2 py-1 text-muted-foreground hover:text-foreground'
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {hasAccount ? (
          <form
            onSubmit={existing.handleSubmit(values => send({ token, password: values.password }))}
            className="space-y-4"
            noValidate
          >
            <Field
              label="Existing password"
              htmlFor="password"
              error={existing.formState.errors.password?.message}
              hint="Confirms this is your account before we attach the new workspace."
            >
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...existing.register('password')}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={existing.formState.isSubmitting}>
              {existing.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Accept invitation
            </Button>
          </form>
        ) : (
          <form onSubmit={newUser.handleSubmit(submitNewUser)} className="space-y-4" noValidate>
            <Field label="Your name" htmlFor="fullName" error={newUser.formState.errors.fullName?.message}>
              <Input id="fullName" autoComplete="name" {...newUser.register('fullName')} />
            </Field>
            <Field
              label="Create password"
              htmlFor="password"
              error={newUser.formState.errors.password?.message}
              hint={PASSWORD_HINT}
            >
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                {...newUser.register('password')}
              />
            </Field>
            <Field
              label="Confirm password"
              htmlFor="confirmPassword"
              error={newUser.formState.errors.confirmPassword?.message}
            >
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...newUser.register('confirmPassword')}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={newUser.formState.isSubmitting}>
              {newUser.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Accept invitation
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
