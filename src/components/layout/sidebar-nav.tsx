'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { NAV_GROUPS, type NavGroup } from '@/config/nav'
import { cn } from '@/lib/utils/cn'

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav({
  groups,
  onNavigate,
}: {
  groups?: NavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const visible = groups ?? NAV_GROUPS

  return (
    <nav className="flex flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {visible.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">
          No workspace access yet. Ask an administrator to invite you.
        </p>
      )}

      {visible.map(group => (
        <div key={group.id} className="space-y-1">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </p>
          {group.items.map(item => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onMouseEnter={() => router.prefetch(item.href)}
                onFocus={() => router.prefetch(item.href)}
                onPointerDown={() => router.prefetch(item.href)}
                onTouchStart={() => router.prefetch(item.href)}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

export function MobileNav({
  open,
  onOpenChange,
  organisationName,
  groups,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organisationName: string
  groups?: NavGroup[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex flex-col gap-0 p-0 text-sidebar-foreground">
        <SheetHeader className="border-b">
          <SheetTitle className="truncate text-sm">{organisationName}</SheetTitle>
          <SheetDescription className="text-xs">AuraDeck CRM</SheetDescription>
        </SheetHeader>
        <SidebarNav groups={groups} onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}
