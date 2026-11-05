/**
 * /api/notifications — list for current user (GET), mark-read (PATCH) and clear (DELETE).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/session'
import { validateCsrf } from '@/lib/auth/csrf'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: NextRequest) {
  const requestId = uuidv4()
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)
  const unreadOnly = searchParams.get('unread') === 'true'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)))

  const where = {
    userId: user.id,
    ...(user.currentOrganisationId ? { organisationId: user.currentOrganisationId } : {}),
    ...(unreadOnly ? { readAt: null } : {}),
  }

  const [items, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page, pageSize, unreadCount }, requestId },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function PATCH(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  let notificationId: string | undefined
  let markAll = false
  try {
    const body = (await req.json()) as { id?: string; all?: boolean }
    notificationId = body.id
    markAll = body.all === true
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body', code: 'VALIDATION_ERROR', requestId }, { status: 400 })
  }

  if (markAll) {
    await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return NextResponse.json({ success: true, data: { marked: 'all' }, requestId })
  }

  if (!notificationId) {
    return NextResponse.json({ success: false, error: 'Provide id or all=true', code: 'VALIDATION_ERROR', requestId }, { status: 400 })
  }

  const result = await db.notification.updateMany({
    where: { id: notificationId, userId: user.id },
    data: { readAt: new Date() },
  })
  if (result.count === 0) {
    return NextResponse.json({ success: false, error: 'Notification not found', code: 'NOT_FOUND', requestId }, { status: 404 })
  }

  return NextResponse.json({ success: true, data: { marked: notificationId }, requestId })
}

export async function DELETE(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ success: false, error: 'id required', code: 'VALIDATION_ERROR', requestId }, { status: 400 })
  }

  await db.notification.deleteMany({ where: { id, userId: user.id } })
  return NextResponse.json({ success: true, data: { deleted: id }, requestId })
}
