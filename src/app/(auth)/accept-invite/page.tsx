import type { Metadata } from 'next'
import { AcceptInviteForm } from './accept-invite-form'

export const metadata: Metadata = { title: 'Accept invitation' }

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return <AcceptInviteForm token={token ?? ''} />
}
