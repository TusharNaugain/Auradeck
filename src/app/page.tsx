import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { DEMO_MODE } from '@/lib/demo-mode'

export default async function Home() {
  if (DEMO_MODE) redirect('/dashboard')
  const user = await getCurrentUser()
  redirect(user ? '/dashboard' : '/login')
}
