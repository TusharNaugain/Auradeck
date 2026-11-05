'use client'

import React from 'react'
import { KeyRound, Loader2, LogOut, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader } from '@/components/shared/page-header'
import { ResourcePage, type ResourceConfig } from '@/components/shared/resource-page'
import { ListView } from '@/components/shared/list-view'
import { SchemaForm, type FieldSpec } from '@/components/shared/schema-form'
import { StatusBadge } from '@/components/shared/status-badge'
import type { Column } from '@/components/shared/table-utils'
import { organisationUpdateSchema, inviteUserSchema, teamCreateSchema, updateUserSchema } from '@/lib/validations/admin'
import { ROLE_SLUGS } from '@/config/roles'
import { api } from '@/lib/client/api'
import { errorMessage, useHasPermission, useInvalidate, useSession } from '@/lib/client/hooks'
import { formatDateTime, formatRelative } from '@/lib/client/format'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DEMO_MODE } from '@/lib/demo-mode'

export default function SettingsPage() {
  const { data: session } = useSession()
  const canManageOrg = useHasPermission('settings.manage')
  const canViewUsers = useHasPermission('users.view')
  const canViewTeams = useHasPermission('teams.view')
  const canViewAudit = useHasPermission('audit.view')

  if (!session) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="Your account, security, and the workspace controls your role allows." />

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          {canManageOrg && <TabsTrigger value="organisation">Organisation</TabsTrigger>}
          {canViewUsers && <TabsTrigger value="members">Members</TabsTrigger>}
          {canViewTeams && <TabsTrigger value="teams">Teams</TabsTrigger>}
          {canViewAudit && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <ProfileTab />
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <SecurityTab mfaEnabled={session.user.mfaEnabled} />
          <SessionsTab />
        </TabsContent>

        {canManageOrg && (
          <TabsContent value="organisation" className="space-y-4">
            <OrganisationTab />
          </TabsContent>
        )}

        {canViewUsers && (
          <TabsContent value="members" className="space-y-4">
            <ResourcePage config={memberConfig} />
          </TabsContent>
        )}

        {canViewTeams && (
          <TabsContent value="teams" className="space-y-4">
            <ResourcePage config={teamConfig} />
          </TabsContent>
        )}

        {canViewAudit && (
          <TabsContent value="audit" className="space-y-4">
            <AuditTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

function useFormCard() {
  const [formError, setFormError] = React.useState('')
  const [pending, setPending] = React.useState(false)
  return { formError, setFormError, pending, setPending }
}

function ProfileTab() {
  const { data: session } = useSession()
  const invalidate = useInvalidate()
  const { formError, setFormError, pending, setPending } = useFormCard()

  const specs: FieldSpec[] = [
    { name: 'fullName', label: 'Full name', kind: 'text', half: true },
    { name: 'jobTitle', label: 'Job title', kind: 'text', half: true },
    { name: 'department', label: 'Department', kind: 'text', half: true },
    { name: 'phoneNumber', label: 'Phone', kind: 'tel', half: true },
    { name: 'phoneCountryCode', label: 'Country code', kind: 'text', half: true, placeholder: '+91' },
    { name: 'timezone', label: 'Timezone', kind: 'text', half: true, placeholder: 'Asia/Kolkata' },
    { name: 'locale', label: 'Locale', kind: 'text', half: true, placeholder: 'en-IN' },
    {
      name: 'notificationPreferences',
      label: 'Notification preferences (JSON)',
      kind: 'json',
      placeholder: '{ "email": true, "inApp": true, "digest": "daily" }',
      hint: 'Leave empty to keep what is stored. Keys are read by the notification worker.',
    },
  ]

  async function submit(values: Record<string, unknown>) {
    setPending(true)
    setFormError('')
    try {
      await api.patch('/api/me', values)
      invalidate(['session'])
      toast.success('Profile updated')
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Your profile</CardTitle>
        <CardDescription>
          Signed in as {session?.user.email}. Empty fields are left unchanged.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SchemaForm
          specs={specs}
          schema={updateUserSchema}
          defaultValues={{
            fullName: session?.user.fullName,
            timezone: session?.user.timezone,
            locale: session?.user.locale,
          }}
          submitLabel="Save profile"
          pending={pending}
          formError={formError}
          onSubmit={submit}
          disabled={DEMO_MODE}
        />
      </CardContent>
    </Card>
  )
}

function OrganisationTab() {
  const { data: session } = useSession()
  const invalidate = useInvalidate()
  const { formError, setFormError, pending, setPending } = useFormCard()

  const current = session?.memberships.find(m => m.organisationId === session?.currentOrganisationId)?.organisation

  const specs: FieldSpec[] = [
    { name: 'displayName', label: 'Display name', kind: 'text', half: true },
    { name: 'legalName', label: 'Legal name', kind: 'text', half: true },
    { name: 'practiceName', label: 'Practice name', kind: 'text', half: true },
    { name: 'practiceType', label: 'Practice type', kind: 'text', half: true, placeholder: 'Physiotherapy' },
    { name: 'industry', label: 'Industry', kind: 'text', half: true },
    { name: 'website', label: 'Website', kind: 'url', half: true },
    { name: 'primaryEmail', label: 'Primary email', kind: 'email', half: true },
    { name: 'primaryPhone', label: 'Primary phone', kind: 'tel', half: true },
    { name: 'addressLine1', label: 'Address', kind: 'text' },
    { name: 'city', label: 'City', kind: 'text', half: true },
    { name: 'state', label: 'State', kind: 'text', half: true },
    { name: 'postalCode', label: 'Postal code', kind: 'text', half: true },
    { name: 'timezone', label: 'Timezone', kind: 'text', half: true, placeholder: 'Asia/Kolkata' },
    { name: 'currency', label: 'Currency', kind: 'text', half: true, placeholder: 'INR' },
    {
      name: 'dateFormat',
      label: 'Date format',
      kind: 'select',
      half: true,
      options: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD'],
    },
    { name: 'language', label: 'Language', kind: 'text', half: true, placeholder: 'en-IN' },
    { name: 'registrationNumber', label: 'Registration number', kind: 'text', half: true },
    { name: 'taxNumber', label: 'Tax number (GSTIN)', kind: 'text', half: true },
    { name: 'logoUrl', label: 'Logo URL', kind: 'url' },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'tags', label: 'Tags', kind: 'tags', placeholder: 'clinic, metro' },
  ]

  async function submit(values: Record<string, unknown>) {
    setPending(true)
    setFormError('')
    try {
      await api.patch('/api/organisations', values)
      invalidate(['session'])
      toast.success('Organisation settings saved')
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Organisation</CardTitle>
        <CardDescription>
          {current
            ? `${current.displayName} · ${current.slug} · ${current.type.toLowerCase()} · ${current.status.toLowerCase()}`
            : 'Workspace settings for the organisation you are currently in.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SchemaForm
          specs={specs}
          schema={organisationUpdateSchema}
          defaultValues={{ displayName: current?.displayName }}
          submitLabel="Save organisation"
          pending={pending}
          formError={formError}
          onSubmit={submit}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          The tax number is encrypted at rest and returned masked. Fields you leave empty keep their stored value.
        </p>
      </CardContent>
    </Card>
  )
}

function SecurityTab({ mfaEnabled }: { mfaEnabled: boolean }) {
  const [provision, setProvision] = React.useState<{ secret: string; otpauthUri: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null)
  const [token, setToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const invalidate = useInvalidate()

  async function startSetup() {
    setBusy(true)
    setError('')
    try {
      setProvision(await api.get<{ secret: string; otpauthUri: string }>('/api/auth/mfa'))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function enable() {
    if (!provision) return
    setBusy(true)
    setError('')
    try {
      const data = await api.post<{ enabled: boolean; recoveryCodes: string[] }>('/api/auth/mfa', {
        secret: provision.secret,
        token: token.trim(),
      })
      setRecoveryCodes(data.recoveryCodes)
      setProvision(null)
      setToken('')
      invalidate(['session'])
      toast.success('Two-factor authentication enabled')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError('')
    try {
      await api.delete('/api/auth/mfa')
      setRecoveryCodes(null)
      invalidate(['session'])
      toast.success('Two-factor authentication disabled')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4" />
          Two-factor authentication
        </CardTitle>
        <CardDescription>
          {mfaEnabled ? 'Enabled — a 6-digit code is required at login.' : 'Not enabled yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {recoveryCodes && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-sm font-medium">Save these recovery codes — shown once.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
              {recoveryCodes.map(code => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
        )}

        {provision ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add this key to Google Authenticator, Authy or 1Password, then confirm with a code.
            </p>
            <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{provision.secret}</p>
            <p className="break-all text-xs text-muted-foreground">{provision.otpauthUri}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={token}
                onChange={e => setToken(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                className="w-32"
                aria-label="Verification code"
              />
              <Button onClick={() => void enable()} disabled={DEMO_MODE || busy || token.trim().length !== 6}>
                Verify and enable
              </Button>
              <Button variant="ghost" onClick={() => setProvision(null)} disabled={DEMO_MODE || busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : mfaEnabled ? (
          <Button variant="outline" size="sm" onClick={() => void disable()} disabled={DEMO_MODE || busy}>
            <XCircle className="size-4" />
            Disable two-factor
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void startSetup()} disabled={DEMO_MODE || busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Set up two-factor
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

interface DeviceSession {
  id: string
  isCurrent: boolean
  browser: string
  os: string
  deviceType: string
  lastActiveAt: string
  expiresAt: string
}

function SessionsTab() {
  const query = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => api.get<{ sessions: DeviceSession[] }>('/api/auth/sessions'),
  })
  const client = useQueryClient()

  async function revoke(id: string) {
    try {
      await api.delete('/api/auth/sessions', undefined, { id })
      void client.invalidateQueries({ queryKey: ['auth-sessions'] })
      if (id !== 'all') toast.success('Session revoked')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  async function signOutEverywhere() {
    await revoke('all')
    window.location.assign('/login')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Active sessions</CardTitle>
        <CardDescription>Devices currently signed in as you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {query.data?.sessions.map(item => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {item.browser} on {item.os}
                {item.isCurrent && <Badge variant="outline" className="ml-2">This device</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.deviceType} · last active {formatRelative(item.lastActiveAt)} · expires {formatDateTime(item.expiresAt)}
              </p>
            </div>
            {!item.isCurrent && (
              <Button variant="ghost" size="sm" onClick={() => void revoke(item.id)} disabled={DEMO_MODE}>
                Revoke
              </Button>
            )}
          </div>
        ))}
        {query.data?.sessions.length === 0 && <p className="text-sm text-muted-foreground">No other sessions.</p>}
        <Button variant="outline" size="sm" onClick={() => void signOutEverywhere()} disabled={DEMO_MODE}>
          <LogOut className="size-4" />
          Sign out everywhere
        </Button>
      </CardContent>
    </Card>
  )
}

interface MemberRow {
  id: string
  user: { id: string; fullName: string; email: string; status: string; lastLoginAt: string | null }
  role: { slug: string; name: string }
  team: { id: string; name: string } | null
}

const memberConfig: ResourceConfig<MemberRow> = {
  key: 'users',
  path: '/api/users',
  title: 'Members',
  description: 'Everyone with an active seat in this organisation.',
  singular: 'member',
  columns: [
    {
      key: 'user',
      header: 'Member',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{row.user.email}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', cell: row => row.role.name },
    { key: 'team', header: 'Team', hideOnMobile: true, cell: row => row.team?.name ?? '—' },
    { key: 'status', header: 'Status', hideOnMobile: true, cell: row => <StatusBadge value={row.user.status} /> },
    {
      key: 'lastLoginAt',
      header: 'Last seen',
      hideOnMobile: true,
      cell: row => (row.user.lastLoginAt ? formatRelative(row.user.lastLoginAt) : 'Never'),
    },
  ],
  // Invitations only: member records are created by accepting an invite, and role
  // or team changes go through the admin workflow, not this screen.
  createFields: [
    { name: 'email', label: 'Email', kind: 'email' },
    { name: 'firstName', label: 'First name', kind: 'text', half: true },
    { name: 'lastName', label: 'Last name', kind: 'text', half: true },
    { name: 'roleSlug', label: 'Role', kind: 'select', options: ROLE_SLUGS, half: true },
    {
      name: 'scopeType',
      label: 'Data scope',
      kind: 'select',
      half: true,
      options: ['own', 'assigned', 'team', 'organisation'],
      hint: 'Which records this member can read.',
    },
    {
      name: 'teamId',
      label: 'Team',
      kind: 'lookup',
      lookup: { path: '/api/teams', label: row => String(row.name ?? '') },
      hint: 'Optional. Required for team-scope roles.',
    },
  ],
  editFields: [],
  createSchema: inviteUserSchema,
  createPermission: 'users.invite',
}

interface TeamRow {
  id: string
  name: string
  description: string | null
  teamType: string
  manager: { fullName: string } | null
  memberships: unknown[]
}

const teamConfig: ResourceConfig<TeamRow> = {
  key: 'teams',
  path: '/api/teams',
  title: 'Teams',
  description: 'Groups used for team-scoped routing, queues and automations.',
  singular: 'team',
  columns: [
    {
      key: 'name',
      header: 'Team',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.description && <p className="truncate text-xs text-muted-foreground">{row.description}</p>}
        </div>
      ),
    },
    { key: 'teamType', header: 'Type', hideOnMobile: true, cell: row => <StatusBadge value={row.teamType} /> },
    { key: 'manager', header: 'Manager', hideOnMobile: true, cell: row => row.manager?.fullName ?? '—' },
    { key: 'members', header: 'Members', cell: row => String(row.memberships.length) },
  ],
  createFields: [
    { name: 'name', label: 'Team name', kind: 'text', half: true },
    { name: 'teamType', label: 'Type', kind: 'select', half: true, options: ['sales', 'csm', 'support', 'finance', 'operations', 'management'] },
    {
      name: 'managerUserId',
      label: 'Manager',
      kind: 'lookup',
      lookup: { path: '/api/users', label: row => String((row.user as MemberRow['user'] | undefined)?.fullName ?? '') },
    },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ],
  editFields: [],
  createSchema: teamCreateSchema,
  createPermission: 'teams.manage',
}

interface AuditRow {
  id: string
  action: string
  resourceType: string | null
  resourceId: string | null
  actorType: string | null
  reason: string | null
  createdAt: string
  actor: { fullName: string } | null
}

function AuditTab() {
  const columns: Column<AuditRow>[] = [
    { key: 'createdAt', header: 'When', cell: row => <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span> },
    {
      key: 'action',
      header: 'Action',
      cell: row => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.action}</p>
          {row.reason && <p className="truncate text-xs text-muted-foreground">{row.reason}</p>}
        </div>
      ),
    },
    {
      key: 'resource',
      header: 'Record',
      hideOnMobile: true,
      cell: row => (row.resourceType ? `${row.resourceType}${row.resourceId ? ` · ${row.resourceId}` : ''}` : '—'),
    },
    {
      key: 'actor',
      header: 'Actor',
      hideOnMobile: true,
      cell: row => row.actor?.fullName ?? row.actorType ?? 'system',
    },
  ]

  return (
    <ListView<AuditRow>
      queryKey="audit"
      path="/api/audit"
      columns={columns}
      singular="audit entry"
      pageSize={25}
      emptyTitle="No audit entries"
      emptyDescription="Record reads and writes are written here as they happen."
    />
  )
}
