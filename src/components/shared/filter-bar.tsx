'use client'

import React from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { enumLabel } from '@/lib/client/format'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface FilterOption {
  value: string
  label: string
}

/** Minimal structural type so any zod v3 enum can be passed without importing zod at runtime. */
type ZodEnumLike = { _def: { values: readonly string[] } }

/** Filter choices read from a zod enum or a plain list, so labels never drift from the API. */
export function enumFilter(schema: readonly string[] | ZodEnumLike): FilterOption[] {
  const values = 'length' in schema ? schema : schema._def.values
  return values.map((value) => ({ value, label: enumLabel(value) }))
}

export interface FilterSpec {
  key: string
  label: string
  options: FilterOption[]
}

const ALL = '__all__'

export function FilterBar({
  filters,
  value,
  onChange,
  placeholder = 'Search…',
  children,
}: {
  filters: FilterSpec[]
  value: Record<string, string | undefined>
  onChange: (next: Record<string, string | undefined>) => void
  placeholder?: string
  children?: React.ReactNode
}) {
  const [term, setTerm] = React.useState(value.search ?? '')

  React.useEffect(() => {
    const id = setTimeout(() => {
      if (term === (value.search ?? '')) return
      onChange({ ...value, search: term || undefined })
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])

  const hasActive = Boolean(value.search) || filters.some(f => value[f.key])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder={placeholder}
          className="pl-8"
          aria-label="Search"
        />
      </div>

      {filters.map(spec => (
        <Select
          key={spec.key}
          value={value[spec.key] ?? ALL}
          onValueChange={next =>
            onChange({ ...value, [spec.key]: next === ALL ? undefined : next })
          }
        >
          <SelectTrigger className="h-9 w-auto min-w-36 gap-1.5" aria-label={spec.label}>
            <SelectValue placeholder={spec.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{spec.label}: All</SelectItem>
            {spec.options.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {children}

      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTerm('')
            const cleared: Record<string, string | undefined> = {}
            for (const spec of filters) cleared[spec.key] = undefined
            onChange({ ...value, ...cleared, search: undefined })
          }}
        >
          <X className="size-4" />
          Clear
        </Button>
      )}
    </div>
  )
}
