import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import { getCurrentUser } from '@/lib/auth/session'
import { buildSessionPayload } from '@/lib/auth/session-payload'
import { DEMO_MODE } from '@/lib/demo-mode'
import { DEMO_SESSION } from '@/lib/client/demo-data'
import { env } from '@/env'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: `${env.NEXT_PUBLIC_APP_NAME}`,
    template: `%s · ${env.NEXT_PUBLIC_APP_NAME}`,
  },
  description:
    'Multi-tenant CRM and practice-management platform for therapy and wellness practices.',
  applicationName: env.NEXT_PUBLIC_APP_NAME,
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b10' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved server-side so the shell renders without a client round-trip.
  // getCurrentUser returns null immediately when no session cookie exists, so
  // public pages pay nothing for this.
  const sessionUser = DEMO_MODE ? null : await getCurrentUser()
  const session = DEMO_MODE
    ? DEMO_SESSION
    : sessionUser
      ? await buildSessionPayload(sessionUser)
      : null

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <Providers initialSession={session}>{children}</Providers>
      </body>
    </html>
  )
}
