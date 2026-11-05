/**
 * POST /api/auth/login — real credential login with lockout + MFA.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loginSchema } from '@/lib/validations/auth'
import { mapDomainError, parseJsonBody } from '@/lib/utils/api-helpers'
import { assertPublicMutationOrigin, requestIpHash } from '@/lib/auth/csrf'
import { login } from '@/lib/auth/service'
import { hashIp, rateLimit, rateLimitResponse, RATE_LIMIT_POLICIES } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()
  try {
    assertPublicMutationOrigin(req)

    const ipHash = requestIpHash(req)
    const rl = await rateLimit(`login:ip:${hashIp(ipHash)}`, RATE_LIMIT_POLICIES.login)
    if (!rl.allowed) return rateLimitResponse(rl)

    const body = await parseJsonBody(req, loginSchema)
    const result = await login(body, {
      ipHash,
      userAgent: req.headers.get('user-agent') ?? '',
    })

    if (result.status === 'mfa_required') {
      return NextResponse.json(
        { success: true, data: { status: 'mfa_required' }, requestId },
        { status: 200 }
      )
    }

    return NextResponse.json(
      { success: true, data: { status: 'ok', organisationId: result.organisationId }, requestId },
      { status: 200 }
    )
  } catch (error) {
    const mapped = mapDomainError(error, requestId)
    if (mapped) return mapped
    logger.error('Login route error', { error: error instanceof Error ? error.stack : String(error), requestId })
    return NextResponse.json(
      { success: false, error: 'Login failed. Please try again.', code: 'INTERNAL_ERROR', requestId },
      { status: 500 }
    )
  }
}
