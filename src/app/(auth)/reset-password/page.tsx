import { Suspense } from 'react'
import type { Metadata } from 'next'
import { ResetForm } from './reset-form'

export const metadata: Metadata = { title: 'Reset password' }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return (
    <Suspense fallback={null}>
      <ResetForm token={token ?? ''} />
    </Suspense>
  )
}
