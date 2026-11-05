/**
 * API utility functions for consistent response formatting,
 * error handling, and request validation.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { ZodError, type ZodTypeAny } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { getCurrentUser } from '@/lib/auth/session'
import { getAuthContext, PermissionDeniedError, type AuthContext } from '@/lib/permissions'
import { logger } from '@/lib/utils/logger'

export interface ApiSuccess<T> {
  success: true
  data: T
  requestId: string
}

export interface ApiError {
  success: false
  error: string
  code: string
  requestId: string
  details?: unknown
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError
type AuthenticatedUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

type AuthResult =
  | { user: AuthenticatedUser; error: null }
  | { user: null; error: NextResponse<ApiError> }

/**
 * Create a successful API response.
 */
export function apiSuccess<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    { success: true, data, requestId: uuidv4() },
    { status }
  )
}

/**
 * Create an error API response with appropriate status code.
 */
export function apiError(
  error: string,
  code: string,
  status: number,
  details?: unknown,
  requestId = uuidv4()
): NextResponse<ApiError> {
  return NextResponse.json(
    { success: false, error, code, requestId, details },
    { status }
  )
}

/**
 * Standard error codes.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

/**
 * Parse and validate a request body using a Zod schema.
 * Returns parsed data or a 400 response for malformed JSON or schema errors.
 */
export async function parseBody<S extends ZodTypeAny>(
  req: NextRequest,
  schema: S
): Promise<S['_output'] | NextResponse<ApiError>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError('Invalid request body', ErrorCodes.VALIDATION_ERROR, 400)
  }

  const result = await schema.safeParseAsync(body)
  if (!result.success) {
    return apiError(
      'Validation failed',
      ErrorCodes.VALIDATION_ERROR,
      400,
      result.error.flatten().fieldErrors
    )
  }
  return result.data
}

/**
 * Require authentication for an API route.
 * Returns the current user or a 401 response.
 */
export async function requireAuth(requestId = uuidv4()): Promise<AuthResult> {
  const user = await getCurrentUser()

  if (!user) {
    return {
      user: null,
      error: apiError('Authentication required', ErrorCodes.AUTH_REQUIRED, 401, undefined, requestId),
    }
  }

  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    return {
      user: null,
      error: apiError('Account is disabled', ErrorCodes.AUTH_REQUIRED, 401, undefined, requestId),
    }
  }

  return { user, error: null }
}

/**
 * Require authentication and organisation membership.
 * Returns both the user and their auth context.
 */
export async function requireAuthAndOrg(
  req: NextRequest,
  organisationId: string
): Promise<
  | { user: AuthenticatedUser; ctx: AuthContext; error: null }
  | { user: null; ctx: null; error: NextResponse<ApiError> }
> {
  const requestId = req.headers.get('x-request-id') ?? uuidv4()
  const { user, error: authError } = await requireAuth(requestId)
  if (authError) {
    return { user: null, ctx: null, error: authError }
  }

  const ctx = await getAuthContext(user.id, organisationId)
  if (!ctx) {
    return {
      user: null,
      ctx: null,
      error: apiError('Access denied', ErrorCodes.PERMISSION_DENIED, 403, undefined, requestId),
    }
  }

  return { user, ctx, error: null }
}

/**
 * Handle errors in API routes consistently.
 */
export function handleApiError(error: unknown, requestId = uuidv4()): NextResponse<ApiError> {
  if (error instanceof PermissionDeniedError) {
    return apiError(error.message, ErrorCodes.PERMISSION_DENIED, 403, undefined, requestId)
  }

  if (error instanceof ZodError) {
    return apiError(
      'Validation failed',
      ErrorCodes.VALIDATION_ERROR,
      400,
      error.flatten().fieldErrors,
      requestId
    )
  }

  logger.error('Unhandled API error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    requestId,
  })

  return apiError(
    'An internal error occurred. Please try again.',
    ErrorCodes.INTERNAL_ERROR,
    500,
    undefined,
    requestId
  )
}

/**
 * Parse pagination parameters from URL search params.
 */
export function parsePagination(searchParams: URLSearchParams): {
  page: number
  pageSize: number
  skip: number
} {
  const parsePositiveInteger = (value: string | null, fallback: number): number => {
    if (!value || !/^\d+$/.test(value)) return fallback
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
  }
  const pageSize = Math.min(100, parsePositiveInteger(searchParams.get('pageSize'), 20))
  const requestedPage = parsePositiveInteger(searchParams.get('page'), 1)
  const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1
  const page = Math.min(requestedPage, maxPage)
  const skip = (page - 1) * pageSize

  return { page, pageSize, skip }
}

/**
 * Wrap async route handlers with error handling.
 */
export function withErrorHandler(
  handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>
) {
  return async (req: NextRequest, context?: unknown): Promise<NextResponse> => {
    const requestId = uuidv4()

    try {
      return await handler(req, context)
    } catch (error) {
      return handleApiError(error, requestId)
    }
  }
}
