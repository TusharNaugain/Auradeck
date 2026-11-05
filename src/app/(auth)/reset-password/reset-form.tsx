'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field, FormMessage } from '@/components/shared/form-field'
import { api, ApiError } from '@/lib/client/api'

const schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters').max(128),
    confirmPassword: z.string(),
  })
  .refine(v => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export function ResetForm({ token }: { token: string }) {
  const router = useRouter()
  const [expired, setExpired] = useState(token.length === 0)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })

  async function onSubmit(values: z.infer<typeof schema>) {
    try {
      await api.post('/api/auth/reset-password', { token, password: values.password })
      router.replace('/login')
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setExpired(true)
        return
      }
      form.setError('root', { message: error instanceof Error ? error.message : 'Reset failed.' })
    }
  }

  if (expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            Link no longer valid
          </CardTitle>
          <CardDescription>
            Reset links expire after a short time and can only be used once. Request a new one to
            continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a
          special character.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormMessage>{form.formState.errors.root?.message}</FormMessage>

          <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={form.formState.errors.confirmPassword?.message}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </Field>

          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
