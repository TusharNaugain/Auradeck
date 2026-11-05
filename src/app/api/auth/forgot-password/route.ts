/**
 * POST /api/auth/forgot-password — issues single-use reset token via email.
 * Always returns 200 (no enumeration).
 */

import { NextRequest, NextResponse } from 'next/server'
import { forgotPasswordSchema } from '@/lib/validations/auth'
import { mapDomainError, parseJsonBody } from '@/lib/utils/api-helpers'
import { assertPublicMutationOrigin, requestIpHash } from '@/lib/auth/csrf'
import { forgotPassword } from '@/lib/auth/service'
import { hashIp, rateLimit, rateLimitResponse, RATE_LIMIT_POLICIES } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { v4 as uuidv4 } from 'uuid'

const UNIFORM_MESSAGE = 'If that email is registered, a reset link has been sent.'

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()
  try {
    assertPublicMutationOrigin(req)
    const rl = await rateLimit(`pwd_reset:ip:${hashIp(requestIpHash(req))}`, RATE_LIMIT_POLICIES.passwordReset)
    if (!rl.allowed) return rateLimitResponse(rl)

    const { email } = await parseJsonBody(req, forgotPasswordSchema)
    await forgotPassword(email)
  } catch (error) {
    // Invalid input or a rejected origin is a client error and must not look like a
    // successful request; only delivery failures stay ambiguous to avoid enumeration.
    const mapped = mapDomainError(error, requestId)
    if (mapped) return mapped
    logger.error('Forgot password error', { requestId, error: error instanceof Error ? error.stack : String(error) })
  }

  return NextResponse.json({ success: true, data: { message: UNIFORM_MESSAGE }, requestId })
}
