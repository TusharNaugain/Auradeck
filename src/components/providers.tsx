'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) => (error as { status?: number })?.status === 401 ? false : count < 2,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

import type { Session } from '@/lib/client/hooks'

export function Providers({
  children,
  initialSession,
}: {
  children: React.ReactNode
  initialSession?: Session | null
}) {
  const [queryClient] = React.useState(() => {
    const client = makeQueryClient()
    // Server-resolved session removes the first fetch and avoids a nav flash.
    if (initialSession) client.setQueryData(['session'], initialSession)
    return client
  })

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
