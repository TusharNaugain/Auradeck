/**
 * Route guard helpers: CSRF + auth + org context + rate limiting combined.
 * Every protected route handler starts with one of these guards.
 * Tenant scoping for individual records is enforced by scoped findFirst queries
 * in each route (db.<model>.findFirst({ where: { id, organisationId } })).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/utils/api'
import { getAuthContext, assertPermission, AuthContext, PermissionDeniedError, type Permission } from '@/lib/permissions'
import { getCurrentUser } from '@/lib/auth/session'
import { validateCsrf, requestIpHash, requestUserAgentHash } from '@/lib/auth/csrf'
import { rateLimit, rateLimitResponse, RATE_LIMIT_POLICIES, RateLimitConfig } from '@/lib/rate-limit'
import { AuthError, setRequestContext } from '@/lib/auth/service'
import { createAuditLog } from '@/lib/audit'
import { logger } from '@/lib/utils/logger'
import { ZodError } from 'zod'
import {
  NotAllowedError,
  NotFoundError,
  ConflictError,
  ValidationFailedError,
  RateLimitedError,
  ProviderError,
} from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

export interface GuardedContext {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>
  ctx: AuthContext
  organisationId: string
  ipHash: string
  userAgentHash: string
}

/**
 * Full guard for state-changing and protected reads:
 * 1. CSRF (origin + double-submit) on mutations
 * 2. Redis rate limit by (policy, user or IP)
 * 3. Session auth (DB-backed, revocation-aware)
 * 4. Membership + permission check (denial is audit-logged)
 */
export async function guardedRoute(
  req: NextRequest,
  options: {
    permission?: Permission
    policy?: keyof typeof RATE_LIMIT_POLICIES
    keyByUser?: boolean
    organisationId?: string
  } = {}
): Promise<{ response?: NextResponse; context?: GuardedContext }> {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !validateCsrf(req)) {
    return {
      response: NextResponse.json(
        { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
        { status: 403 }
      ),
    }
  }

  const { user, error: authError } = await requireAuth(requestId)
  if (authError || !user) {
    return { response: authError ?? undefined }
  }

  const ipHash = requestIpHash(req)
  const userAgentHash = requestUserAgentHash(req)
  setRequestContext({ requestId, ipHash, userAgentHash })

  if (options.policy) {
    const config: RateLimitConfig = { ...RATE_LIMIT_POLICIES[options.policy] }
    const keyPart = options.keyByUser ? `u:${user.id}` : `ip:${ipHash}`
    const result = await rateLimit(`${options.policy}:${keyPart}`, config)
    if (!result.allowed) {
      return { response: rateLimitResponse(result) }
    }
  }

  const organisationId = options.organisationId ?? user.currentOrganisationId
  if (!organisationId) {
    return {
      response: NextResponse.json(
        { success: false, error: 'No active organisation in session', code: 'NO_ORGANISATION', requestId },
        { status: 403 }
      ),
    }
  }

  const ctx = await getAuthContext(user.id, organisationId)
  if (!ctx) {
    await createAuditLog({
      organisationId,
      actorUserId: user.id,
      action: 'membership.denied',
      resourceType: 'organisation',
      resourceId: organisationId,
      requestId,
      reason: 'No active membership',
    })
    return {
      response: NextResponse.json(
        { success: false, error: 'Access denied', code: 'PERMISSION_DENIED', requestId },
        { status: 403 }
      ),
    }
  }

  if (options.permission) {
    await assertPermission(ctx, options.permission)
  }

  return { context: { user, ctx, organisationId, ipHash, userAgentHash } }
}

/**
 * Map a thrown error to the standard API error envelope.
 * Public (unauthenticated) routes call this directly because they build their own
 * try/catch around origin checks and rate limiting instead of using guardedRoute.
 * Returns null when the error is not a recognised domain error, so callers can
 * rethrow it and keep the 500 path in one place.
 */
export function mapDomainError(error: unknown, requestId: string): NextResponse | null {
  if (error instanceof Error && error.message === 'CSRF_ORIGIN_REJECTED') {
    return NextResponse.json(
      { success: false, error: 'Cross-origin request rejected', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId },
      { status: 400 }
    )
  }
  if (error instanceof AuthError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code, requestId },
      { status: error.status }
    )
  }
  if (error instanceof ValidationFailedError) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'VALIDATION_ERROR', details: error.details, requestId },
      { status: 400 }
    )
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ success: false, error: error.message, code: 'NOT_FOUND', requestId }, { status: 404 })
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ success: false, error: error.message, code: 'CONFLICT', requestId }, { status: 409 })
  }
  if (error instanceof NotAllowedError || error instanceof PermissionDeniedError) {
    return NextResponse.json({ success: false, error: error.message, code: 'PERMISSION_DENIED', requestId }, { status: 403 })
  }
  if (error instanceof RateLimitedError) {
    return NextResponse.json(
      { success: false, error: error.message, code: 'RATE_LIMITED', requestId },
      { status: 429, headers: { 'retry-after': String(error.retryAfterSeconds) } }
    )
  }
  if (error instanceof ProviderError) {
    return NextResponse.json({ success: false, error: error.message, code: 'PROVIDER_ERROR', requestId }, { status: 502 })
  }
  return null
}

/**
 * Wrap a route handler so all thrown domain errors map to safe HTTP responses
 * and unexpected errors log server-side diagnostics with a request ID.
 * Generic over the route's own context type declared in the handler.
 */
export function routeHandler<TContext>(
  handler: (req: NextRequest, context: TContext) => Promise<NextResponse>
): (req: NextRequest, context: unknown) => Promise<NextResponse> {
  return async (req: NextRequest, routeContext: unknown) => {
    const requestId = req.headers.get('x-request-id') ?? uuidv4()
    try {
      return await handler(req, routeContext as TContext)
    } catch (error) {
      const mapped = mapDomainError(error, requestId)
      if (mapped) return mapped
      logger.error('Unhandled route error', {
        requestId,
        path: req.nextUrl.pathname,
        error: error instanceof Error ? error.stack : String(error),
      })
      return NextResponse.json(
        { success: false, error: 'An internal error occurred. Please try again.', code: 'INTERNAL_ERROR', requestId },
        { status: 500 }
      )
    }
  }
}

/**
 * Safely parse a JSON body through a zod schema, mapping failures to a safe 400.
 * Generic over the schema type so output is always correctly inferred.
 */
export async function parseJsonBody<S extends import('zod').ZodTypeAny>(
  req: NextRequest,
  schema: S
): Promise<import('zod').infer<S>> {
  let json: unknown
  try {
    json = await req.json()
  } catch {
    throw new ValidationFailedError('Request body must be valid JSON')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new ValidationFailedError('Validation failed', parsed.error.flatten().fieldErrors)
  }
  return parsed.data
}
