import type { Metadata } from 'next'
import { VerifyPanel } from './verify-panel'

export const metadata: Metadata = { title: 'Verify email' }

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <VerifyPanel token={token ?? ''} />
}
