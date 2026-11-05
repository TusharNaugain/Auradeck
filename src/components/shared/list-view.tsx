'use client'

import React from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/empty-state'
import type { Column } from '@/components/shared/table-utils'
import { pluralise, totalPages } from '@/components/shared/table-utils'
import { errorMessage, useList } from '@/lib/client/hooks'
import { cn } from '@/lib/utils/cn'

interface ListViewProps<T> {
  queryKey: string
  path: string
  columns: Column<T>[]
  singular: string
  filters?: Record<string, string | number | undefined>
  pageSize?: number
  rowHref?: (row: T) => string
  /** Trailing right-aligned cell, e.g. the Edit button wired by ResourcePage. */
  actions?: (row: T) => React.ReactNode
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  toolbar?: React.ReactNode
}

export function ListView<T>({
  queryKey,
  path,
  columns,
  singular,
  filters,
  pageSize = 20,
  rowHref,
  actions,
  emptyTitle,
  emptyDescription,
  emptyAction,
  toolbar,
}: ListViewProps<T>) {
  const [page, setPage] = React.useState(1)
  const filtersKey = JSON.stringify(filters ?? {})
  const stableFilters = React.useMemo<Record<string, string | number | undefined>>(
    () => JSON.parse(filtersKey),
    [filtersKey]
  )
  const query = React.useMemo(
    () => ({ ...stableFilters, page, pageSize }),
    [stableFilters, page, pageSize]
  )
  const { data, isPending, isError, error, refetch } = useList<T>([queryKey], path, query)

  const rows = data?.items ?? []
  const lastPage = data ? totalPages(data.total, data.pageSize) : 1

  React.useEffect(() => {
    setPage(1)
  }, [stableFilters])

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12">
          <EmptyState
            title="Could not load"
            description={errorMessage(error)}
            icon={<RefreshCw className="size-5" />}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Retry
              </Button>
            }
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {toolbar}
      <Card>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12">
              <EmptyState
                title={emptyTitle ?? `No ${pluralise(0, singular).replace('0 ', '')}`}
                description={emptyDescription ?? 'Nothing matches the current filters yet.'}
                action={emptyAction}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead
                        key={col.key}
                        className={cn(col.hideOnMobile && 'hidden md:table-cell', col.className)}
                      >
                        {col.header}
                      </TableHead>
                    ))}
                    {actions && (
                      <TableHead className="w-0">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => (
                    <TableRow
                      key={(row as { id: string }).id}
                      className={cn(rowHref && 'cursor-pointer')}
                    >
                      {columns.map((col) => {
                        const href = rowHref?.(row)
                        const content = (
                          <TableCell
                            key={col.key}
                            className={cn(
                              col.hideOnMobile && 'hidden md:table-cell',
                              col.className
                            )}
                          >
                            {col.cell(row, index)}
                          </TableCell>
                        )
                        if (!href || col.key !== columns[0].key) return content
                        return (
                          <TableCell key={col.key} className={col.className}>
                            <Link href={href} prefetch={false} className="font-medium hover:underline">
                              {col.cell(row, index)}
                            </Link>
                          </TableCell>
                        )
                      })}
                      {actions && <TableCell className="text-right">{actions(row)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>{pluralise(data.total, singular)}</span>
          <div className="flex items-center gap-2">
            <span>
              Page {data.page} of {lastPage}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous page"
              disabled={data.page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next page"
              disabled={data.page >= lastPage}
              onClick={() => setPage(p => Math.min(lastPage, p + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
