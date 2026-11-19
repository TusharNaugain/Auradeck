'use client'

/**
 * Settings -> Members and Settings -> Roles & access.
 * Members: invite, change role / visibility / team, deactivate and reactivate.
 * Roles & access: the per-organisation permission matrix (editable by the super admin).
 * Every action here is enforced again by the API; the UI only hides what the role can't do.
 */

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, Lock, MoreHorizontal, RotateCcw, Search, ShieldCheck, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/shared/empty-state'
import { api } from '@/lib/client/api'
import { errorMessage, useHasPermission, useInvalidate, useSession } from '@/lib/client/hooks'
import { formatRelative } from '@/lib/client/format'
import { cn } from '@/lib/utils/cn'
import {
  SUPER_ADMIN_ROLE, TEAM_ROLES, VISIBILITY_OPTIONS, teamRole, visibilityLabel, type RecordScope,
} from '@/lib/permissions/access'

/* ---------- shared ---------- */

type Visibility = 'default' | 'organisation' | 'team' | 'own'

function toVisibility(scope: RecordScope | null): Visibility {
  if (!scope) return 'default'
  if (scope === 'ORGANISATION') return 'organisation'
  if (scope === 'TEAM') return 'team'
  return 'own'
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || '?'
}

interface RoleMatrixData {
  groups: Array<{ id: string; label: string; capabilities: Array<{ key: string; label: string; description: string }> }>
  roles: Array<{
    slug: string
    name: string
    description: string
    locked: boolean
    customised: boolean
    updatedAt: string | null
    recordScope: RecordScope
    capabilities: string[]
    defaultScope: RecordScope
    defaultCapabilities: string[]
    memberCount: number
  }>
  canEdit: boolean
}

function useRoleMatrix() {
  return useQuery({
    queryKey: ['access-roles'],
    queryFn: () => api.get<RoleMatrixData>('/api/access/roles'),
  })
}

/* ---------- Members ---------- */

interface MemberRow {
  id: string
  userId: string
  status: 'ACTIVE' | 'DEACTIVATED' | 'PENDING'
  scopeOverride: RecordScope | null
  user: { id: string; fullName: string; email: string; status: string; lastLoginAt: string | null }
  role: { slug: string; name: string }
  team: { id: string; name: string } | null
}

interface TeamOption { id: string; name: string }

export function MembersPanel() {
  const { data: session } = useSession()
  const canManage = useHasPermission('users.manage')
  const canInvite = useHasPermission('users.invite')
  const canViewTeams = useHasPermission('teams.view')
  const invalidate = useInvalidate()
  const [search, setSearch] = React.useState('')
  const [showInactive, setShowInactive] = React.useState(false)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const query = { search: search.trim() || undefined, includeInactive: showInactive ? 'true' : undefined, pageSize: 100 }
  const members = useQuery({
    queryKey: ['users', 'members', query],
    queryFn: () => api.get<{ items: MemberRow[]; total: number }>('/api/users', query),
  })
  const roles = useRoleMatrix()
  const teams = useQuery({
    queryKey: ['teams', 'options'],
    queryFn: () => api.get<{ items: TeamOption[] }>('/api/teams', { pageSize: 100 }),
    enabled: canViewTeams,
  })

  const actorIsSuper = session?.roleSlug === SUPER_ADMIN_ROLE
  const roleScope = (slug: string): RecordScope | undefined =>
    roles.data?.roles.find(r => r.slug === slug)?.recordScope ?? teamRole(slug)?.defaultScope

  async function update(member: MemberRow, body: Record<string, unknown>, success: string) {
    setBusy(member.id)
    try {
      await api.patch(`/api/users/${member.id}`, body)
      toast.success(success)
      invalidate(['users'], ['access-roles'])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  async function deactivate(member: MemberRow) {
    if (!window.confirm(`Deactivate ${member.user.fullName}? They lose access to the CRM immediately. Their leads stay assigned to them until you reassign them.`)) return
    setBusy(member.id)
    try {
      await api.delete(`/api/users/${member.id}`)
      toast.success(`${member.user.fullName} deactivated`)
      invalidate(['users'], ['access-roles'])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const items = members.data?.items ?? []
  const activeCount = items.filter(m => m.status === 'ACTIVE').length

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            Invite your Marketing, Sales and Customer Success people and choose what each one can do and see.
          </CardDescription>
        </div>
        {canInvite && (
          <Button size="sm" onClick={() => setInviteOpen(true)} className="shrink-0">
            <UserPlus className="size-4" />
            Invite member
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email" className="pl-8" />
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{activeCount} active</span>
            {canManage && (
              <label className="flex items-center gap-2">
                <Switch checked={showInactive} onCheckedChange={setShowInactive} />
                Show deactivated
              </label>
            )}
          </div>
        </div>

        {members.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <EmptyState title="No members found" description={search ? 'Try a different search.' : 'Invite your first team member to get started.'} />
        ) : (
          <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-lg sm:border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">Member</TableHead>
                  <TableHead className="min-w-44">Role</TableHead>
                  <TableHead className="min-w-44">Can see</TableHead>
                  <TableHead className="hidden md:table-cell">Team</TableHead>
                  <TableHead className="hidden md:table-cell">Last seen</TableHead>
                  <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(member => {
                  const isSelf = member.userId === session?.user.id
                  const isSuperTarget = member.role.slug === SUPER_ADMIN_ROLE
                  const inactive = member.status !== 'ACTIVE'
                  const editable = canManage && !isSelf && !inactive && (!isSuperTarget || actorIsSuper)
                  const legacyRole = !teamRole(member.role.slug)
                  const scopeDefault = roleScope(member.role.slug)
                  return (
                    <TableRow key={member.id} className={cn(inactive && 'opacity-60')}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {initials(member.user.fullName)}
                          </div>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 truncate font-medium">
                              {member.user.fullName}
                              {isSelf && <Badge variant="secondary" className="text-[10px]">You</Badge>}
                              {inactive && <Badge variant="destructive" className="text-[10px]">Deactivated</Badge>}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Select
                            value={member.role.slug}
                            disabled={busy === member.id}
                            onValueChange={slug => update(member, { roleSlug: slug }, `${member.user.fullName} is now ${teamRole(slug)?.name ?? slug}`)}
                          >
                            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TEAM_ROLES.filter(r => actorIsSuper || r.slug !== SUPER_ADMIN_ROLE).map(r => (
                                <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>
                              ))}
                              {legacyRole && <SelectItem value={member.role.slug} disabled>{member.role.name}</SelectItem>}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="flex items-center gap-1.5 text-sm">
                            {isSuperTarget && <ShieldCheck className="size-3.5 text-primary" />}
                            {teamRole(member.role.slug)?.name ?? member.role.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editable && !isSuperTarget ? (
                          <Select
                            value={toVisibility(member.scopeOverride)}
                            disabled={busy === member.id}
                            onValueChange={v => update(member, { scopeType: v }, 'Visibility updated')}
                          >
                            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Role default · {visibilityLabel(scopeDefault)}</SelectItem>
                              <SelectItem value="organisation">All records</SelectItem>
                              <SelectItem value="team" disabled={!member.team}>Team records{!member.team ? ' (needs a team)' : ''}</SelectItem>
                              <SelectItem value="own">Own records</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {isSuperTarget ? 'All records' : visibilityLabel(member.scopeOverride ?? scopeDefault)}
                            {member.scopeOverride && !isSuperTarget && <span className="ml-1 text-xs">(custom)</span>}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {editable && canViewTeams && (teams.data?.items.length ?? 0) > 0 ? (
                          <Select
                            value={member.team?.id ?? 'none'}
                            disabled={busy === member.id}
                            onValueChange={v => update(member, { teamId: v === 'none' ? null : v }, 'Team updated')}
                          >
                            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No team</SelectItem>
                              {teams.data?.items.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-muted-foreground">{member.team?.name ?? '—'}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {member.user.lastLoginAt ? formatRelative(member.user.lastLoginAt) : 'Never'}
                      </TableCell>
                      <TableCell>
                        {canManage && !isSelf && (!isSuperTarget || actorIsSuper) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8" disabled={busy === member.id} aria-label={`Actions for ${member.user.fullName}`}>
                                {busy === member.id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {inactive ? (
                                <DropdownMenuItem onClick={() => update(member, { status: 'active' }, `${member.user.fullName} reactivated`)}>
                                  Reactivate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deactivate(member)}>
                                  Deactivate
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        actorIsSuper={actorIsSuper}
        teams={teams.data?.items ?? []}
        roleScope={roleScope}
        onInvited={() => invalidate(['users'], ['access-roles'])}
      />
    </Card>
  )
}

function InviteDialog({
  open, onOpenChange, actorIsSuper, teams, roleScope, onInvited,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actorIsSuper: boolean
  teams: TeamOption[]
  roleScope: (slug: string) => RecordScope | undefined
  onInvited: () => void
}) {
  const empty = { email: '', firstName: '', lastName: '', roleSlug: 'sales_rep', scopeType: 'default' as Visibility, teamId: 'none' }
  const [form, setForm] = React.useState(empty)
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => { if (open) setForm(empty) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }))
  const role = teamRole(form.roleSlug)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/api/users', {
        email: form.email.trim(),
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        roleSlug: form.roleSlug,
        scopeType: form.scopeType,
        teamId: form.teamId === 'none' ? null : form.teamId,
      })
      toast.success(`Invitation sent to ${form.email.trim()}`, {
        description: 'They can sign in with Google using this email straight away.',
      })
      onInvited()
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They get access right away and can sign in with Google using this email.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Work email</Label>
            <Input id="invite-email" type="email" required value={form.email} onChange={e => set({ email: e.target.value })} placeholder="name@company.com" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-first">First name</Label>
              <Input id="invite-first" value={form.firstName} onChange={e => set({ firstName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-last">Last name</Label>
              <Input id="invite-last" value={form.lastName} onChange={e => set({ lastName: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={form.roleSlug} onValueChange={v => set({ roleSlug: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TEAM_ROLES.filter(r => actorIsSuper || r.slug !== SUPER_ADMIN_ROLE).map(r => (
                  <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role && <p className="text-xs text-muted-foreground">{role.description}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Can see</Label>
              <Select value={form.scopeType} onValueChange={v => set({ scopeType: v as Visibility })} disabled={form.roleSlug === SUPER_ADMIN_ROLE}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Role default · {visibilityLabel(roleScope(form.roleSlug))}</SelectItem>
                  <SelectItem value="organisation">All records</SelectItem>
                  <SelectItem value="team" disabled={form.teamId === 'none'}>Team records</SelectItem>
                  <SelectItem value="own">Own records</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={form.teamId} onValueChange={v => set({ teamId: v, ...(v === 'none' && form.scopeType === 'team' ? { scopeType: 'default' as Visibility } : {}) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No team</SelectItem>
                  {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !form.email.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Roles & access ---------- */

type Draft = Record<string, { capabilities: Set<string>; recordScope: RecordScope }>

export function RolesAccessPanel() {
  const matrix = useRoleMatrix()
  const invalidate = useInvalidate()
  const [draft, setDraft] = React.useState<Draft>({})
  const [saving, setSaving] = React.useState(false)

  const data = matrix.data
  const canEdit = Boolean(data?.canEdit)

  const current = (slug: string) => {
    const role = data!.roles.find(r => r.slug === slug)!
    return draft[slug] ?? { capabilities: new Set(role.capabilities), recordScope: role.recordScope }
  }
  const isDirty = (slug: string) => {
    const d = draft[slug]
    if (!d) return false
    const role = data!.roles.find(r => r.slug === slug)!
    return d.recordScope !== role.recordScope
      || d.capabilities.size !== role.capabilities.length
      || role.capabilities.some(c => !d.capabilities.has(c))
  }
  const dirtyRoles = data ? data.roles.filter(r => isDirty(r.slug)) : []

  function toggle(slug: string, key: string, on: boolean) {
    const next = current(slug)
    const caps = new Set(next.capabilities)
    if (on) caps.add(key)
    else caps.delete(key)
    setDraft(d => ({ ...d, [slug]: { ...next, capabilities: caps } }))
  }
  function setScope(slug: string, scope: RecordScope) {
    setDraft(d => ({ ...d, [slug]: { ...current(slug), recordScope: scope } }))
  }

  async function save() {
    setSaving(true)
    try {
      for (const role of dirtyRoles) {
        const d = draft[role.slug]
        await api.put(`/api/access/roles/${role.slug}`, { capabilities: Array.from(d.capabilities), recordScope: d.recordScope })
      }
      toast.success(`Access updated for ${dirtyRoles.map(r => r.name).join(', ')}`, {
        description: 'Changes apply to every member with that role on their next action.',
      })
      setDraft({})
      invalidate(['access-roles'], ['session'])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function reset(slug: string, name: string) {
    if (!window.confirm(`Reset ${name} to the built-in defaults?`)) return
    try {
      await api.delete(`/api/access/roles/${slug}`)
      setDraft(d => { const rest = { ...d }; delete rest[slug]; return rest })
      toast.success(`${name} reset to defaults`)
      invalidate(['access-roles'], ['session'])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  if (matrix.isLoading || !data) {
    return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Roles &amp; access</CardTitle>
        <CardDescription>
          Choose what each role can do and which records it can see. Every member gets their role&apos;s access;
          you can still widen or narrow one person&apos;s visibility under Members.
        </CardDescription>
        {!canEdit && (
          <p className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
            <Lock className="size-4" /> Only a super admin can change role access. You are viewing it read-only.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="-mx-4 overflow-x-auto sm:mx-0 sm:rounded-lg sm:border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 min-w-56 bg-muted/40 px-3 py-3 text-left font-medium backdrop-blur">Access</th>
                {data.roles.map(role => (
                  <th key={role.slug} className="min-w-32 px-2 py-3 text-center align-top font-medium">
                    <div className="flex flex-col items-center gap-1">
                      <span className="flex items-center gap-1">
                        {role.locked && <Lock className="size-3 text-muted-foreground" />}
                        {role.name}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'}
                      </span>
                      {isDirty(role.slug) ? (
                        <Badge variant="warning" className="text-[10px]">Unsaved</Badge>
                      ) : role.customised ? (
                        <span className="flex items-center gap-1">
                          <Badge variant="default" className="text-[10px]">Customised</Badge>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => reset(role.slug, role.name)}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Reset ${role.name} to defaults`}
                              title="Reset to defaults"
                            >
                              <RotateCcw className="size-3" />
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Default</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="sticky left-0 z-10 bg-card px-3 py-3">
                  <p className="font-medium">Record visibility</p>
                  <p className="text-xs text-muted-foreground">Which leads, deals and accounts the role sees.</p>
                </td>
                {data.roles.map(role => (
                  <td key={role.slug} className="px-2 py-3 text-center">
                    {role.locked || !canEdit ? (
                      <span className="text-xs font-medium">{visibilityLabel(current(role.slug).recordScope)}</span>
                    ) : (
                      <Select value={current(role.slug).recordScope} onValueChange={v => setScope(role.slug, v as RecordScope)}>
                        <SelectTrigger className="mx-auto h-8 w-32 text-xs" aria-label={`${role.name} visibility`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VISIBILITY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                ))}
              </tr>
              {data.groups.map(group => (
                <React.Fragment key={group.id}>
                  <tr className="border-b bg-muted/20">
                    <td colSpan={data.roles.length + 1} className="px-0 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {/* The label sticks, not the full-width cell, so it stays visible while the matrix scrolls sideways. */}
                      <span className="sticky left-0 inline-block px-3">{group.label}</span>
                    </td>
                  </tr>
                  {group.capabilities.map(cap => (
                    <tr key={cap.key} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="sticky left-0 z-10 bg-card px-3 py-2.5">
                        <p className="font-medium">{cap.label}</p>
                        <p className="text-xs text-muted-foreground">{cap.description}</p>
                      </td>
                      {data.roles.map(role => {
                        const on = current(role.slug).capabilities.has(cap.key)
                        return (
                          <td key={role.slug} className="px-2 py-2.5 text-center">
                            {role.locked || !canEdit ? (
                              on ? <Check className="mx-auto size-4 text-primary" aria-label="Allowed" /> : <span className="text-muted-foreground" aria-label="Not allowed">–</span>
                            ) : (
                              <Checkbox
                                checked={on}
                                onCheckedChange={v => toggle(role.slug, cap.key, v === true)}
                                aria-label={`${role.name}: ${cap.label}`}
                              />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className={cn(
            'sticky bottom-3 z-20 flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm transition-opacity sm:flex-row sm:items-center sm:justify-between',
            dirtyRoles.length === 0 && 'pointer-events-none opacity-0',
          )}>
            <p className="text-sm text-muted-foreground">
              Unsaved changes for <span className="font-medium text-foreground">{dirtyRoles.map(r => r.name).join(', ')}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDraft({})} disabled={saving}>Discard</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
