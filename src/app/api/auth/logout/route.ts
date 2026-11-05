/**
 * POST /api/auth/logout — clears the session cookie and revokes DB session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { clearSession, getSession } from '@/lib/auth/session'
import { assertPublicMutationOrigin } from '@/lib/auth/csrf'
import { createAuditLog } from '@/lib/audit'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const requestId = uuidv4()
  try {
    assertPublicMutationOrigin(req)
    const session = await getSession()
    const userId = session.userId

    await clearSession()

    if (userId) {
      await createAuditLog({
        actorUserId: userId,
        action: 'auth.logout',
        resourceType: 'auth',
        resourceId: userId,
        requestId,
      })
    }

    return NextResponse.json({ success: true, data: { loggedOut: true }, requestId })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Logout failed', code: 'INTERNAL_ERROR', requestId },
      { status: 500 }
    )
  }
}
