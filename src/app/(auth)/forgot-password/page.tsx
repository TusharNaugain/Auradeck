'use client'

import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FormMessage } from '@/components/shared/form-field'
import { api } from '@/lib/client/api'

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
})

export default function ForgotPasswordPage() {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  const [sent, setSent] = React.useState(false)

  async function onSubmit(values: z.infer<typeof schema>) {
    await api.post('/api/auth/forgot-password', values).catch(() => undefined)
    // Always report the same outcome — the endpoint never reveals whether the email exists.
    setSent(true)
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" />
            Request received
          </CardTitle>
          <CardDescription>
            If that address is registered, a reset link is on its way. The link expires shortly and
            can be used once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
          <button
            type="button"
            className="w-full text-sm text-muted-foreground hover:underline"
            onClick={() => setSent(false)}
          >
            Use a different email
          </button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot password</CardTitle>
        <CardDescription>Enter your work email and we will send a reset link.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormMessage>{form.formState.errors.root?.message}</FormMessage>
          <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={Boolean(form.formState.errors.email)}
              {...form.register('email')}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Send reset link
          </Button>
          <p className="text-center text-sm">
            <Link href="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
