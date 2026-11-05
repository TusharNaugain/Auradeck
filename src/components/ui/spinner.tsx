'use client'

import * as React from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('h-4 w-4 animate-spin', className)} aria-hidden />
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  )
}
