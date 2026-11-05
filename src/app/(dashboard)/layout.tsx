import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { DEMO_MODE } from '@/lib/demo-mode'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!DEMO_MODE) {
    const user = await getCurrentUser()
    if (!user) redirect('/login?next=/dashboard')
  }

  return <DashboardShell>{children}</DashboardShell>
}
