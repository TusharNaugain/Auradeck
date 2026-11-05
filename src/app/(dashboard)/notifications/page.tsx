'use client'

import React from 'react'
import Link from 'next/link'
import { Bell, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ListView } from '@/components/shared/list-view'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import type { Column } from '@/components/shared/table-utils'
import { api } from '@/lib/client/api'
import { useInvalidate } from '@/lib/client/hooks'
import { formatDateTime, formatRelative } from '@/lib/client/format'
import { toast } from 'sonner'
import { DEMO_MODE } from '@/lib/demo-mode'

interface NotificationRow {
  id: string
  type: string
  title: string
  message: string
  severity: string
  actionUrl: string | null
  readAt: string | null
  createdAt: string
}

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = React.useState(false)
  const invalidate = useInvalidate()

  async function markRead(id: string) {
    try {
      await api.patch('/api/notifications', { id })
      invalidate(['notifications'])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark as read')
    }
  }

  async function markAllRead() {
    try {
      await api.patch('/api/notifications', { all: true })
      invalidate(['notifications'])
      toast.success('All notifications marked as read')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update notifications')
    }
  }

  async function remove(id: string) {
    try {
      await api.delete('/api/notifications', undefined, { id })
      invalidate(['notifications'])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete notification')
    }
  }

  const columns: Column<NotificationRow>[] = [
    {
      key: 'title',
      header: 'Notification',
      cell: row => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            {!row.readAt && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
            <span className={row.readAt ? 'text-muted-foreground' : 'font-medium'}>{row.title}</span>
          </div>
          <p className="line-clamp-2 text-sm text-muted-foreground">{row.message}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', hideOnMobile: true, cell: row => <Badge variant="outline">{row.type}</Badge> },
    { key: 'severity', header: 'Severity', hideOnMobile: true, cell: row => <StatusBadge value={row.severity} /> },
    {
      key: 'createdAt',
      header: 'Received',
      hideOnMobile: true,
      cell: row => <span title={formatDateTime(row.createdAt)}>{formatRelative(row.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Reminders, assignments and system alerts addressed to you."
      />

      <ListView<NotificationRow>
        queryKey="notifications"
        path="/api/notifications"
        columns={columns}
        singular="notification"
        pageSize={25}
        filters={{ unread: unreadOnly ? 'true' : undefined }}
        emptyTitle={unreadOnly ? 'Nothing unread' : 'No notifications'}
        emptyDescription="Assignments, follow-up reminders and system alerts show up here."
        actions={DEMO_MODE ? undefined : row => (
          <div className="flex items-center justify-end gap-1">
            {row.actionUrl && (
              <Button variant="ghost" size="sm" asChild onClick={() => void markRead(row.id)}>
                <Link href={row.actionUrl}>Open</Link>
              </Button>
            )}
            {!row.readAt && (
              <Button variant="ghost" size="icon" aria-label="Mark as read" onClick={() => void markRead(row.id)}>
                <Check className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => void remove(row.id)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={unreadOnly ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setUnreadOnly(v => !v)}
            >
              <Bell className="size-4" />
              Unread only
            </Button>
            <Button variant="outline" size="sm" onClick={() => void markAllRead()} disabled={DEMO_MODE}>
              <Check className="size-4" />
              Mark all read
            </Button>
          </div>
        }
      />
    </div>
  )
}
