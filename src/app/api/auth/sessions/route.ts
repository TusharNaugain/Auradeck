/**
 * GET /api/auth/sessions — device/session list for the current user.
 * DELETE /api/auth/sessions?id=all — revoke all sessions (logout everywhere).
 * DELETE /api/auth/sessions?id=<sessionId> — revoke one session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession, getCurrentUser, revokeAllSessions } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'
import { deviceInfoFor } from '@/lib/auth/device'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: NextRequest) {
  const requestId = uuidv4()
  const session = await getSession()
  if (!session.userId) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  const raw = await db.session.findMany({
    where: { userId: session.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastActiveAt: 'desc' },
    select: {
      id: true,
      deviceInfo: true,
      lastActiveAt: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  // Determine the current session to mark it
  const sessions = raw.map((s) => ({
    id: s.id,
    isCurrent: s.id === session.sessionId,
    ...deviceInfoFor(s.deviceInfo as Record<string, unknown>),
    lastActiveAt: s.lastActiveAt,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  }))

  void req
  return NextResponse.json({ success: true, data: { sessions }, requestId })
}

export async function DELETE(req: NextRequest) {
  const requestId = uuidv4()
  const session = await getSession()
  if (!session.userId) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (id === 'all') {
    await revokeAllSessions(session.userId)
    await createAuditLog({
      actorUserId: session.userId,
      action: 'auth.sessions_revoked_all',
      resourceType: 'session',
      resourceId: session.userId,
      requestId,
    })
    return NextResponse.json({ success: true, data: { revoked: 'all' }, requestId })
  }

  if (!id) {
    return NextResponse.json(
      { success: false, error: 'Missing id parameter', code: 'VALIDATION_ERROR', requestId },
      { status: 400 }
    )
  }

  // Must belong to caller (anti-IDOR)
  const target = await db.session.findFirst({
    where: { id, userId: session.userId },
    select: { id: true },
  })
  if (!target) {
    return NextResponse.json(
      { success: false, error: 'Record not found', code: 'NOT_FOUND', requestId },
      { status: 404 }
    )
  }

  const isCurrent = target.id === session.sessionId
  await db.session.update({ where: { id }, data: { revokedAt: new Date() } })
  await createAuditLog({
    actorUserId: session.userId,
    action: 'auth.session_revoked',
    resourceType: 'session',
    resourceId: id,
    requestId,
  })

  return NextResponse.json({ success: true, data: { revoked: id, isCurrent }, requestId })
}

void getCurrentUser
