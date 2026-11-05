/**
 * Typed service errors with a consistent wire format. Route handlers map
 * these to HTTP responses without leaking internal details.
 */

export class NotAllowedError extends Error {
  public readonly statusCode = 403
  public readonly code = 'PERMISSION_DENIED'
  constructor(message = 'You do not have permission to perform this action') {
    super(message)
    this.name = 'NotAllowedError'
  }
}

export class NotFoundError extends Error {
  public readonly statusCode = 404
  public readonly code = 'NOT_FOUND'
  constructor(message = 'Record not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  public readonly statusCode = 409
  public readonly code = 'CONFLICT'
  constructor(message = 'A conflicting record already exists') {
    super(message)
    this.name = 'ConflictError'
  }
}

export class ValidationFailedError extends Error {
  public readonly statusCode = 400
  public readonly code = 'VALIDATION_ERROR'
  constructor(message = 'Request validation failed', public details?: unknown) {
    super(message)
    this.name = 'ValidationFailedError'
  }
}

export class ProviderError extends Error {
  public readonly statusCode = 502
  public readonly code = 'PROVIDER_ERROR'
  constructor(provider: string, detail?: string) {
    super(`${provider} request failed${detail ? `: ${detail}` : ''}`)
    this.name = 'ProviderError'
  }
}

export class RateLimitedError extends Error {
  public readonly statusCode = 429
  public readonly code = 'RATE_LIMITED'
  constructor(public retryAfterSeconds: number) {
    super('Too many requests. Please try again later.')
    this.name = 'RateLimitedError'
  }
}

export class AuthFailedError extends Error {
  public readonly statusCode = 401
  public readonly code = 'AUTH_REQUIRED'
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthFailedError'
  }
}
