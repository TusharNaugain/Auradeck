/**
 * POST /api/me/switch-org — switch active organisation.
 * Verifies the target organisation has a valid ACTIVE membership first.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession, getCurrentUser } from '@/lib/auth/session'
import { validateCsrf } from '@/lib/auth/csrf'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const session = await getSession()
  const user = await getCurrentUser()
  if (!session.userId || !user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  let organisationId: string
  try {
    const body = (await req.json()) as { organisationId?: string }
    if (!body.organisationId) throw new Error()
    organisationId = body.organisationId
  } catch {
    return NextResponse.json(
      { success: false, error: 'organisationId is required', code: 'VALIDATION_ERROR', requestId },
      { status: 400 }
    )
  }

  const membership = await db.membership.findFirst({
    where: { userId: session.userId, organisationId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!membership) {
    return NextResponse.json(
      { success: false, error: 'You are not a member of that organisation', code: 'PERMISSION_DENIED', requestId },
      { status: 403 }
    )
  }

  // Mutate the session cookie only — no DB mutation needed
  session.organisationId = organisationId
  await session.save()

  await createAuditLog({
    actorUserId: session.userId,
    organisationId,
    action: 'organisation.switch',
    resourceType: 'organisation',
    resourceId: organisationId,
    requestId,
  })

  return NextResponse.json({ success: true, data: { organisationId }, requestId })
}

void getCurrentUser
