/**
 * POST /api/auth/accept-invite — turn an invitation token into an active membership.
 * Creates the user when one does not exist yet, otherwise attaches them to the org.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { mapDomainError, parseJsonBody } from '@/lib/utils/api-helpers'
import { assertPublicMutationOrigin, requestIpHash } from '@/lib/auth/csrf'
import { acceptInvitation } from '@/lib/auth/service'
import { hashIp, rateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { logger } from '@/lib/utils/logger'
import { v4 as uuidv4 } from 'uuid'

const acceptInviteSchema = z.object({
  token: z.string().min(16, 'Invitation token is missing or malformed'),
  password: z.string().min(8).max(128).optional(),
  fullName: z.string().trim().min(2).max(100).optional(),
})

export async function POST(req: NextRequest) {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()
  try {
    assertPublicMutationOrigin(req)
    const rl = await rateLimit(`accept-invite:${hashIp(requestIpHash(req))}`, {
      max: 10,
      windowSeconds: 600,
      prefix: 'rl:accept-invite',
    })
    if (!rl.allowed) return rateLimitResponse(rl)

    const body = await parseJsonBody(req, acceptInviteSchema)
    const result = await acceptInvitation(body)

    return NextResponse.json(
      { success: true, data: { userId: result.userId, organisationId: result.organisationId }, requestId },
      { status: 201 }
    )
  } catch (error) {
    const mapped = mapDomainError(error, requestId)
    if (mapped) return mapped
    logger.error('Accept invite error', { requestId, error: error instanceof Error ? error.stack : String(error) })
    return NextResponse.json(
      { success: false, error: 'Unable to accept this invitation.', code: 'INTERNAL_ERROR', requestId },
      { status: 500 }
    )
  }
}
