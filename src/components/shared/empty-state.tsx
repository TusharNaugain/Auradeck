'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/** Shared empty/error/no-permission panel so every list page behaves the same. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center', className)}>
      {icon ? <div className="text-muted-foreground [&_svg]:h-8 [&_svg]:w-8">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {description ? <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}
