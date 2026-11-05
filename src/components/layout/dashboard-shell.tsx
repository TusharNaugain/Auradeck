'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import {
  Bell,
  Building2,
  Check,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/client/api'
import { initials } from '@/lib/client/format'
import { filterNav } from '@/config/nav'
import { MobileNav, SidebarNav } from '@/components/layout/sidebar-nav'
import { BrandLogo } from '@/components/shared/brand-logo'
import { useSession, type Session } from '@/lib/client/hooks'
import { DEMO_MODE } from '@/lib/demo-mode'
import { isSheetImportMode } from '@/lib/client/demo-data'

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle?: string
  url: string
}

interface NotificationRow {
  id: string
  title: string
  message: string
  severity: string
  readAt: string | null
  actionUrl: string | null
  createdAt: string
}

export function DashboardTopbar({
  session,
  onMenuClick,
  organisationName,
}: {
  session: Session
  onMenuClick: () => void
  organisationName?: string
}) {
  const organisation = session.memberships.find(m => m.organisationId === session.currentOrganisationId)

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
        <Menu className="size-5" />
      </Button>

      <div className="min-w-0 flex-1">
        {organisation && (
          <p className="truncate text-sm font-semibold">{organisationName ?? organisation.organisation.displayName}</p>
        )}
      </div>

      <GlobalSearch />
      <NotificationsMenu />
      <ThemeToggle />
      <OrgSwitcher session={session} organisationName={organisationName} />
      <UserMenu session={session} />
    </header>
  )
}

function GlobalSearch() {
  const [term, setTerm] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const [results, setResults] = React.useState<SearchResult[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    const trimmed = term.trim()
    if (trimmed.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setLoading(true)
    const id = setTimeout(() => {
      void api
        .get<{ results: SearchResult[] }>('/api/search', { q: trimmed })
        .then(payload => {
          if (!cancelled) setResults(payload.results)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [term])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="hidden h-8 w-56 justify-start gap-2 text-muted-foreground sm:inline-flex">
          <Search className="size-3.5" />
          Search records…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        <Input
          autoFocus
          value={term}
          onChange={e => setTerm(e.target.value)}
          placeholder="Leads, accounts, contacts, clients, tickets…"
          aria-label="Search records"
        />
        <div className="mt-2 max-h-80 overflow-y-auto">
          {loading && (
            <div className="space-y-1.5 p-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {!loading && term.trim().length >= 2 && results.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No matches.</p>
          )}
          {!loading &&
            results.map(item => (
              <Link
                key={`${item.type}-${item.id}`}
                href={item.url}
                onClick={() => {
                  setOpen(false)
                  setTerm('')
                }}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{item.type}</span>
              </Link>
            ))}
          {!loading && term.trim().length < 2 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Type at least two characters.
            </p>
          )}
        </div>
        <p className="border-t px-2 pb-1 pt-2 text-[11px] text-muted-foreground">
          Clinical notes and patient health details are never searchable.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function NotificationsMenu() {
  const router = useRouter()
  const [items, setItems] = React.useState<NotificationRow[] | null>(null)
  const [unread, setUnread] = React.useState(0)

  async function load() {
    const data = await api.get<{ items: NotificationRow[]; unreadCount: number }>(
      '/api/notifications',
      { pageSize: 10 }
    )
    setItems(data.items)
    setUnread(data.unreadCount)
  }

  async function markAllRead() {
    await api.patch('/api/notifications', { all: true }).catch(() => undefined)
    setItems(null)
    setUnread(0)
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          onClick={() => {
            if (items === null) void load().catch(() => setItems([]))
          }}
        >
          <Bell className="size-4.5" />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-destructive" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread > 0 && <span className="text-xs font-normal text-muted-foreground">{unread} unread</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items === null && (
          <div className="px-2 py-4">
            <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {items?.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing new right now.</p>
        )}
        {items?.map(item => (
          <DropdownMenuItem key={item.id} asChild>
            <Link
              href={item.actionUrl ?? '/notifications'}
              prefetch={false}
              className="flex flex-col items-start gap-0.5"
              onClick={() => {
                if (!DEMO_MODE) {
                  void api.patch('/api/notifications', { id: item.id }).catch(() => undefined)
                  setUnread(n => Math.max(0, n - 1))
                }
              }}
            >
              <span className="flex w-full items-center gap-1.5 text-sm font-medium">
                {!item.readAt && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                <span className="truncate">{item.title}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{item.message}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void markAllRead()} disabled={DEMO_MODE}>
          <Check className="size-4" />
          Mark all read
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/notifications" prefetch={false}>View all notifications</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OrgSwitcher({ session, organisationName }: { session: Session; organisationName?: string }) {
  if (session.memberships.length < 2) {
    const only = session.memberships[0]
    if (!only) return null
    return (
      <div className="hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground md:flex">
        <Building2 className="size-3.5" />
        <span className="max-w-32 truncate">{organisationName ?? only.organisation.displayName}</span>
      </div>
    )
  }

  async function switchTo(organisationId: string) {
    await api.post('/api/me/switch-org', { organisationId }).catch(() => undefined)
    window.location.assign('/dashboard')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="hidden max-w-44 gap-1.5 md:inline-flex">
          <Building2 className="size-4 shrink-0" />
          <span className="truncate">
            {organisationName ??
              session.memberships.find(m => m.organisationId === session.currentOrganisationId)?.organisation.displayName ??
              'Switch workspace'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session.memberships.map(membership => (
          <DropdownMenuItem
            key={membership.organisationId}
            onSelect={() => void switchTo(membership.organisationId)}
            className="flex items-center justify-between gap-2"
          >
            <span className="truncate">{membership.organisation.displayName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{membership.role.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ session }: { session: Session }) {
  async function signOut() {
    if (DEMO_MODE) {
      window.location.assign('/login')
      return
    }
    await api.post('/api/auth/logout').catch(() => undefined)
    window.location.assign('/login')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-7">
            {session.user.avatarUrl && <AvatarImage src={session.user.avatarUrl} alt="" />}
            <AvatarFallback className="text-xs">{initials(session.user.fullName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{session.user.fullName}</span>
          <span className="block truncate text-xs text-muted-foreground">{session.user.email}</span>
          <span className="block truncate pt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {session.roleSlug?.replace('_', ' ')}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" prefetch={false}>
            <Settings className="size-4" />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="text-destructive focus:text-destructive">
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const isDark = mounted && resolvedTheme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  // The root layout seeds this cache entry, so the first render already has it.
  const { data: session } = useSession()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [sheetImportMode, setSheetImportMode] = React.useState(false)

  React.useEffect(() => {
    setSheetImportMode(isSheetImportMode())
  }, [])

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const groups = filterNav(session.permissions)
  const sourceOrganisationName =
    session.memberships.find(m => m.organisationId === session.currentOrganisationId)?.organisation.displayName ??
    'AuraDeck CRM'
  const organisationName = sheetImportMode ? 'AuraDeck · Local sheet import' : sourceOrganisationName

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-14 items-center border-b px-4">
          <BrandLogo size="compact" className="w-full" />
        </div>
        <SidebarNav groups={groups} />
      </aside>

      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} organisationName={organisationName} groups={groups} />

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar session={session} organisationName={organisationName} onMenuClick={() => setMobileOpen(true)} />
        {DEMO_MODE && (
          <div
            role="status"
            className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-950"
          >
            {sheetImportMode
              ? 'Local sheet import · CRM changes are saved only in this browser; other modules have no live database data and automatic sheet sync is not configured.'
              : 'Demo workspace · Lead, interaction, and subscription status changes save only in this browser · Other data is sample-only and does not sync to a database.'}
          </div>
        )}
        <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  )
}
