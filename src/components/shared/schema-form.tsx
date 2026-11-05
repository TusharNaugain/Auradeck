'use client'

import React from 'react'
import { useForm, type Resolver, type DefaultValues } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { Loader2, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FormMessage } from '@/components/shared/form-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/client/api'

export type FieldKind = 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'number' | 'datetime' | 'date' | 'checkbox' | 'tags' | 'lookup' | 'json'

/** A search-backed foreign-key picker, e.g. the client of an appointment. */
export interface LookupSpec {
  /** List endpoint to search, e.g. `/api/clients`. */
  path: string
  label: (row: Record<string, unknown>) => string
  detail?: (row: Record<string, unknown>) => string
  /** Extra fixed query params for the search. */
  query?: Record<string, string | number>
}

export interface FieldSpec {
  name: string
  label: string
  kind: FieldKind
  /** For selects: literal list, or a zod enum (values are read from it). */
  options?: readonly string[] | { _def: { values: readonly string[] } }
  lookup?: LookupSpec
  placeholder?: string
  hint?: string
  /** Render at half width on wide dialogs. */
  half?: boolean
  /** Only used for creates — the form omits the field when editing. */
  createOnly?: boolean
  disabled?: boolean
}

/** Read the allowed values straight out of a zod enum so the UI can never drift. */
export function enumValues(options: FieldSpec['options']): string[] {
  if (!options) return []
  if ('length' in options) return [...options]
  return [...options._def.values]
}

const NONE = '__none__'

function toIsoLocal(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined
  const iso = endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59` : value
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Normalise raw form input into exactly what the shared zod schema expects:
 * blanks become undefined, datetimes become ISO strings, tags become arrays.
 * Keeping this in one place is what lets every module reuse the server schema
 * on the client without drift.
 */
export function normalisePayload(values: Record<string, unknown>, specs: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const raw = values[spec.name]
    if (spec.kind === 'datetime') {
      const iso = toIsoLocal(String(raw ?? ''))
      if (iso !== undefined) out[spec.name] = iso
      else if (raw === '' || raw === undefined || raw === null) out[spec.name] = undefined
      else out[spec.name] = raw
      continue
    }
    if (spec.kind === 'date') {
      // Date-only inputs are ambiguous; treat them as start-of-day UTC so list
      // filters and record dates stay comparable.
      const iso = raw ? new Date(`${String(raw)}T00:00:00`).toISOString() : undefined
      if (iso) out[spec.name] = iso
      continue
    }
    if (spec.kind === 'tags') {
      const list = String(raw ?? '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)
      if (list.length) out[spec.name] = list
      continue
    }
    if (spec.kind === 'json') {
      const text = String(raw ?? '').trim()
      if (!text) continue
      try {
        out[spec.name] = JSON.parse(text)
      } catch {
        // Left as text so the shared zod schema reports this field as invalid.
        out[spec.name] = text
      }
      continue
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (trimmed !== '') out[spec.name] = trimmed
      continue
    }
    if (raw !== undefined && raw !== null) out[spec.name] = raw
  }
  return out
}

/** Flip an ISO timestamp back into the value a datetime-local input expects. */
export function toInputValue(value: unknown, kind: FieldKind): string {
  if (value === undefined || value === null) return ''
  if (kind === 'json') {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }
  if (kind === 'tags') return Array.isArray(value) ? value.join(', ') : String(value)
  if (kind === 'datetime') {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  if (kind === 'date') {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
  }
  if (typeof value === 'boolean') return value ? 'on' : ''
  return String(value)
}

export function initialValuesFromRow(row: Record<string, unknown>, specs: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const raw = row[spec.name]
    if (spec.kind === 'checkbox') out[spec.name] = Boolean(raw)
    else out[spec.name] = toInputValue(raw, spec.kind)
  }
  return out
}

interface SchemaFormProps<TValues extends object> {
  specs: FieldSpec[]
  schema: z.ZodType<TValues>
  defaultValues?: Partial<TValues>
  submitLabel?: string
  /** External busy flag, e.g. an in-flight API mutation. */
  pending?: boolean
  disabled?: boolean
  formError?: string
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>
  className?: string
}

/**
 * One form renderer for every module, validated by the same zod schema the API
 * route uses. The resolver types are widened deliberately: the shared schemas
 * are `.superRefine`/`.transform` chains whose inferred input differs from the
 * submitted shape, and `normalisePayload` bridges them.
 */
export function SchemaForm<TValues extends object>({
  specs,
  schema,
  defaultValues,
  submitLabel = 'Save',
  pending,
  disabled = false,
  formError,
  onSubmit,
  className,
}: SchemaFormProps<TValues>) {
  const form = useForm<Record<string, unknown>>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as z.ZodType<any>) as unknown as Resolver<Record<string, unknown>>,
    defaultValues: (defaultValues ?? {}) as DefaultValues<Record<string, unknown>>,
  })

  const isSubmitting = form.formState.isSubmitting || Boolean(pending)

  return (
    <form
      onSubmit={form.handleSubmit(values => onSubmit(normalisePayload(values, specs)))}
      className={cn('space-y-4', className)}
      noValidate
    >
      <FormMessage>{formError ?? form.formState.errors.root?.message}</FormMessage>

      <div className="grid gap-4 sm:grid-cols-2">
        {specs.map(spec => {
          const error = (form.formState.errors as Record<string, { message?: string }>)[spec.name]?.message
          const id = `field-${spec.name}`
          const registered = form.register(spec.name)
          const fullWidth = spec.kind === 'textarea' || spec.kind === 'json' || !spec.half

          return (
            <Field
              key={spec.name}
              label={spec.label}
              htmlFor={id}
              error={error}
              hint={spec.hint}
              className={cn(fullWidth && 'sm:col-span-2', 'min-w-0')}
            >
              {spec.kind === 'textarea' || spec.kind === 'json' ? (
                <Textarea
                  id={id}
                  rows={spec.kind === 'json' ? 8 : 4}
                  className={spec.kind === 'json' ? 'font-mono text-xs' : undefined}
                  placeholder={spec.placeholder}
                  disabled={disabled || spec.disabled}
                  {...registered}
                />
              ) : spec.kind === 'select' ? (
                <SelectValueHarness
                  id={id}
                  field={spec.name}
                  form={form}
                  options={enumValues(spec.options)}
                  disabled={disabled || spec.disabled}
                  placeholder={spec.placeholder ?? spec.label}
                />
              ) : spec.kind === 'lookup' ? (
                <LookupHarness
                  id={id}
                  field={spec.name}
                  form={form}
                  lookup={spec.lookup}
                  disabled={disabled || spec.disabled}
                  placeholder={spec.placeholder ?? `Select ${spec.label.toLowerCase()}`}
                />
              ) : spec.kind === 'checkbox' ? (
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id={id}
                    checked={form.watch(spec.name) === true}
                    disabled={disabled || spec.disabled}
                    onCheckedChange={checked => form.setValue(spec.name, checked === true, { shouldValidate: true })}
                  />
                  <Label htmlFor={id} className="font-normal">
                    {spec.label}
                  </Label>
                </div>
              ) : spec.kind === 'number' ? (
                <Input id={id} type="number" inputMode="decimal" placeholder={spec.placeholder} disabled={disabled || spec.disabled} {...registered} />
              ) : (
                <Input
                  id={id}
                  type={spec.kind === 'tags' ? 'text' : spec.kind}
                  placeholder={spec.placeholder}
                  aria-invalid={Boolean(error)}
                  disabled={disabled || spec.disabled}
                  {...registered}
                />
              )}
            </Field>
          )
        })}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting || disabled}>
        {isSubmitting && <Loader2 className="size-4 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  )
}

/**
 * Search-backed single select for foreign keys. The list endpoint is the only
 * place names exist, so the human label lives beside the field and the stored
 * value stays the id the API expects.
 */
function LookupHarness({
  id,
  field,
  form,
  lookup,
  placeholder,
  disabled,
}: {
  id: string
  field: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  lookup?: LookupSpec
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [term, setTerm] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [label, setLabel] = React.useState<string | null>(null)
  const selected = (form.watch(field) as string) || ''

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 250)
    return () => clearTimeout(timer)
  }, [term])

  const { data, isFetching } = useQuery({
    queryKey: ['lookup', lookup?.path, debounced, lookup?.query ?? {}],
    queryFn: () =>
      api.get<{ items: Record<string, unknown>[] }>(lookup!.path, {
        ...lookup?.query,
        search: debounced || undefined,
        pageSize: 10,
      }),
    enabled: open && !disabled,
  })

  const rows = data?.items ?? []

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            disabled={disabled}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={cn('truncate text-left', !selected && 'text-muted-foreground')}>
              {label || selected || placeholder}
            </span>
            <Search className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="p-2">
            <Input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Search…" className="h-8" />
          </div>
          <div className="max-h-60 overflow-y-auto border-t p-1">
            {isFetching ? (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">No matches</div>
            ) : (
              rows.map(row => (
                <button
                  key={String(row.id)}
                  type="button"
                  className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    form.setValue(field, String(row.id), { shouldValidate: true })
                    setLabel(lookup!.label(row))
                    setOpen(false)
                  }}
                >
                  <span className="block truncate text-sm font-medium">{lookup!.label(row)}</span>
                  {lookup?.detail && (
                    <span className="block truncate text-xs text-muted-foreground">{lookup.detail(row)}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {selected && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Clear ${field}`}
          onClick={() => {
            form.setValue(field, '', { shouldValidate: true })
            setLabel(null)
          }}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  )
}

function SelectValueHarness({
  id,
  field,
  form,
  options,
  placeholder,
  disabled,
}: {
  id: string
  field: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  options: string[]
  placeholder: string
  disabled?: boolean
}) {
  const value = form.watch(field) as string
  return (
    <Select
      value={value || NONE}
      onValueChange={next => form.setValue(field, next === NONE ? '' : next, { shouldValidate: true })}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>None</SelectItem>
        {options.map(option => (
          <SelectItem key={option} value={option}>
            {labelFor(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function labelFor(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => (i === 0 ? word[0]?.toUpperCase() + word.slice(1) : word.toLowerCase()))
    .join(' ')
}
