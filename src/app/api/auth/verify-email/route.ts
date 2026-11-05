/**
 * POST /api/auth/verify-email — consumes a single-use verification token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEmailSchema } from '@/lib/validations/auth'
import { mapDomainError, parseJsonBody } from '@/lib/utils/api-helpers'
import { assertPublicMutationOrigin } from '@/lib/auth/csrf'
import { verifyEmailToken } from '@/lib/auth/service'
import { logger } from '@/lib/utils/logger'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()
  try {
    assertPublicMutationOrigin(req)
    const { token } = await parseJsonBody(req, verifyEmailSchema)
    const result = await verifyEmailToken(token)

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'This verification link is invalid or has expired.', code: 'TOKEN_INVALID', requestId },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, data: { verified: true }, requestId })
  } catch (error) {
    const mapped = mapDomainError(error, requestId)
    if (mapped) return mapped
    logger.error('Verify email error', { requestId, error: error instanceof Error ? error.stack : String(error) })
    return NextResponse.json(
      { success: false, error: 'Verification failed', code: 'INTERNAL_ERROR', requestId },
      { status: 500 }
    )
  }
}
