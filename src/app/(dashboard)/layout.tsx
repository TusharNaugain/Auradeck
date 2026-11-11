import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { DEMO_MODE } from '@/lib/demo-mode'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!DEMO_MODE) {
    const user = await getCurrentUser()
    // `expired` stops the middleware bouncing a stale cookie straight back to /dashboard.
    if (!user) redirect('/login?next=/dashboard&expired=1')
  }

  return <DashboardShell>{children}</DashboardShell>
}
