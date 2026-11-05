/**
 * POST /api/auth/reset-password — consumes token and sets new password.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resetPasswordSchema } from '@/lib/validations/auth'
import { mapDomainError, parseJsonBody } from '@/lib/utils/api-helpers'
import { assertPublicMutationOrigin, requestIpHash } from '@/lib/auth/csrf'
import { resetPassword } from '@/lib/auth/service'
import { hashIp, rateLimit, rateLimitResponse, RATE_LIMIT_POLICIES } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()
  try {
    assertPublicMutationOrigin(req)
    const rl = await rateLimit(`pwd_reset:ip:${hashIp(requestIpHash(req))}`, RATE_LIMIT_POLICIES.passwordReset)
    if (!rl.allowed) return rateLimitResponse(rl)

    const { token, password } = await parseJsonBody(req, resetPasswordSchema)
    await resetPassword(token, password)

    return NextResponse.json({
      success: true,
      data: { message: 'Password updated. Please sign in with your new password.' },
      requestId,
    })
  } catch (error) {
    const mapped = mapDomainError(error, requestId)
    if (mapped) return mapped
    logger.error('Reset password error', { requestId, error: error instanceof Error ? error.stack : String(error) })
    return NextResponse.json(
      { success: false, error: 'Password reset failed', code: 'INTERNAL_ERROR', requestId },
      { status: 500 }
    )
  }
}
