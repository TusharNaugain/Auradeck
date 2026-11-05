/**
 * POST /api/auth/register — user registration with optional practice organisation.
 */

import { NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

export async function POST() {
  const requestId = uuidv4()
  return NextResponse.json(
    { success: false, error: 'Team accounts are created by an administrator.', code: 'INVITE_REQUIRED', requestId },
    { status: 403 }
  )
}
