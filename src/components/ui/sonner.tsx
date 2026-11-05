'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="top-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: 'group border-border bg-background text-foreground shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground rounded-md',
          cancelButton: 'bg-muted text-muted-foreground rounded-md',
        },
      }}
    />
  )
}
