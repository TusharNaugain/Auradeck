'use client'

import React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { FilterBar, type FilterSpec } from '@/components/shared/filter-bar'
import { ListView } from '@/components/shared/list-view'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SchemaForm, initialValuesFromRow, type FieldSpec } from '@/components/shared/schema-form'
import type { Column } from '@/components/shared/table-utils'
import { api, ApiError } from '@/lib/client/api'
import { errorMessage, useInvalidate, useHasPermission } from '@/lib/client/hooks'
import { toast } from 'sonner'
import type { z } from 'zod'
import { DEMO_MODE } from '@/lib/demo-mode'

export interface ResourceConfig<TRow> {
  /** React Query key and API path, e.g. `leads` -> `/api/leads`. */
  key: string
  path: string
  title: string
  description?: string
  singular: string
  columns: Column<TRow>[]
  createFields: FieldSpec[]
  editFields?: FieldSpec[]
  createSchema: z.ZodTypeAny
  editSchema?: z.ZodTypeAny
  filters?: FilterSpec[]
  createPermission?: string
  editPermission?: string
  /** When set, each row gets a Remove button that calls DELETE `${path}/${id}`. */
  deletePermission?: string
  deleteConfirm?: (row: TRow) => string
  rowId?: (row: TRow) => string
  rowLabel?: (row: TRow) => string
}

/**
 * List + create + edit for a module, driven entirely by config. Shared by the
 * CRM, practice, support and billing areas so behaviour stays uniform and the
 * client validates against the same zod schemas the route handlers use.
 */
export function ResourcePage<TRow>({
  config,
  pageSize = 20,
  extraToolbar,
}: {
  config: ResourceConfig<TRow>
  pageSize?: number
  extraToolbar?: React.ReactNode
}) {
  const [filters, setFilters] = React.useState<Record<string, string | undefined>>({})
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TRow | null>(null)
  const [formError, setFormError] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const invalidate = useInvalidate()
  const hasCreatePermission = useHasPermission(config.createPermission ?? '')
  const hasEditPermission = useHasPermission(config.editPermission ?? '')
  const canCreate = !DEMO_MODE && hasCreatePermission
  const canEdit = !DEMO_MODE && hasEditPermission
  const hasDeletePermission = useHasPermission(config.deletePermission ?? '')
  const canDelete = !DEMO_MODE && Boolean(config.deletePermission) && hasDeletePermission

  const rowId = config.rowId ?? ((row: TRow) => (row as { id: string }).id)

  async function removeRow(row: TRow) {
    const message = config.deleteConfirm?.(row) ?? `Remove this ${config.singular}?`
    if (!window.confirm(message)) return
    try {
      await api.delete(`${config.path}/${rowId(row)}`)
      toast.success(`${config.singular} removed`)
      invalidate([config.key])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function submitCreate(values: Record<string, unknown>) {
    setPending(true)
    setFormError('')
    try {
      await api.post(config.path, values)
      toast.success(`${config.singular} created`)
      setCreateOpen(false)
      invalidate([config.key])
    } catch (error) {
      setFormError(errorMessage(error))
      if (error instanceof ApiError && error.status === 403) setCreateOpen(false)
    } finally {
      setPending(false)
    }
  }

  async function submitEdit(values: Record<string, unknown>) {
    if (!editing) return
    setPending(true)
    setFormError('')
    try {
      await api.patch(`${config.path}/${rowId(editing)}`, values)
      toast.success(`${config.singular} updated`)
      setEditing(null)
      invalidate([config.key])
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  const editFields = config.editFields ?? config.createFields
  const editable = editFields.length > 0 && (!config.editPermission || canEdit)

  return (
    <div className="space-y-5">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          config.createPermission ? (
            <Button onClick={() => setCreateOpen(true)} disabled={!canCreate} title={canCreate ? undefined : 'Your role cannot create these records'}>
              <Plus className="size-4" />
              New {config.singular}
            </Button>
          ) : null
        }
      />

      <FilterBar
        filters={config.filters ?? []}
        value={filters}
        onChange={setFilters}
        placeholder={`Search ${config.title.toLowerCase()}…`}
      >
        {extraToolbar}
      </FilterBar>

      <ListView<TRow>
        queryKey={config.key}
        path={config.path}
        columns={config.columns}
        singular={config.singular}
        filters={filters}
        pageSize={pageSize}
        actions={
          editable || canDelete
            ? (row) => (
                <div className="flex items-center justify-end gap-1">
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(row); setFormError('') }}>
                      <Pencil className="size-4" />
                      Edit
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void removeRow(row)}>
                      <Trash2 className="size-4" />
                      Remove
                    </Button>
                  )}
                </div>
              )
            : undefined
        }
      />

      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) setFormError('') }}>
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New {config.singular}</DialogTitle>
            <DialogDescription>Fields follow the same rules the API enforces.</DialogDescription>
          </DialogHeader>
          <SchemaForm
            specs={config.createFields}
            schema={config.createSchema}
            submitLabel={`Create ${config.singular}`}
            pending={pending}
            formError={formError}
            onSubmit={submitCreate}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={open => { if (!open) { setEditing(null); setFormError('') } }}>
        <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {config.singular}</DialogTitle>
            <DialogDescription>
              {editing && config.rowLabel ? config.rowLabel(editing) : 'Update this record.'}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <SchemaForm
              key={rowId(editing)}
              specs={editFields}
              schema={config.editSchema ?? config.createSchema}
              defaultValues={initialValuesFromRow(editing as Record<string, unknown>, editFields)}
              submitLabel="Save changes"
              pending={pending}
              formError={formError}
              onSubmit={submitEdit}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
