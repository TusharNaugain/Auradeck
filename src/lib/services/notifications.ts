/**
 * Notification service: in-app notification creation + optional channel fan-out
 * (email/SMS/WhatsApp providers are abstracted and optional).
 * NEVER place protected data (phone, clinical info, amounts of pending payments)
 * into the message preview — titles/messages must be tenant-role-safe.
 */

import { Prisma, NotificationSeverity } from '@prisma/client'
import { db } from '@/lib/db'
import { logger } from '@/lib/utils/logger'

type Severity = 'info' | 'success' | 'warning' | 'error'

const SEVERITY: Record<Severity, NotificationSeverity> = {
  info: 'INFO',
  success: 'SUCCESS',
  warning: 'WARNING',
  error: 'ERROR',
}

interface NotificationCreateParams {
  userIds: string[]
  organisationId?: string
  type: string
  title: string
  message?: string
  severity?: Severity
  actionUrl?: string
}

export async function createNotifications(params: NotificationCreateParams): Promise<void> {
  if (params.userIds.length === 0) return

  const data: Prisma.NotificationCreateManyInput[] = params.userIds.map((userId) => ({
    userId,
    organisationId: params.organisationId,
    type: params.type,
    title: params.title,
    message: params.message ?? '',
    severity: SEVERITY[params.severity ?? 'info'],
    actionUrl: params.actionUrl,
  }))

  try {
    await db.notification.createMany({ data })
  } catch (err) {
    // Notifications are best-effort; don't break the main transaction flow
    logger.error('Failed to create notifications', {
      error: err instanceof Error ? err.message : String(err),
      type: params.type,
    })
  }
}

/**
 * Notify users with specific role slugs within an organisation
 * (e.g. notify the CSM who owns an account).
 */
export async function notifyRole(
  organisationId: string,
  roleSlug: string,
  params: Omit<NotificationCreateParams, 'userIds' | 'organisationId'>
): Promise<void> {
  const memberships = await db.membership.findMany({
    where: {
      organisationId,
      status: 'ACTIVE',
      role: { slug: roleSlug },
    },
    select: { userId: true },
  })
  await createNotifications({
    userIds: memberships.map((m) => m.userId),
    organisationId,
    ...params,
  })
}
