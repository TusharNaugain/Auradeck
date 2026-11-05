/**
 * Browser-side API client. Every mutation carries the double-submit CSRF header
 * (the cookie is issued by middleware) and a per-request ID for tracing.
 * A 401 from any endpoint returns the user to the login page for their area.
 */

import { getDemoResponse } from '@/lib/client/demo-data'
import { DEMO_MODE } from '@/lib/demo-mode'

const CSRF_COOKIE = 'auradeck_csrf'

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CSRF_FAILED'
  | 'INTERNAL_ERROR'
  | string

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly requestId?: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase()
  const isMutation = !IDEMPOTENT.has(method)

  if (DEMO_MODE) {
    if (isMutation && !(
      (method === 'POST' && path === '/api/leads') ||
      (method === 'PATCH' && /^\/api\/leads\/[^/]+$/.test(path)) ||
      (method === 'POST' && path === '/api/activities') ||
      (method === 'PATCH' && /^\/api\/billing\/subscriptions\/[^/]+$/.test(path))
    )) {
      throw new ApiError('Only lead, interaction, and subscription changes are saved locally in demo mode. Connect the backend for other changes.', 'DEMO_READ_ONLY', 403)
    }
    return getDemoResponse<T>(path, options.query, method, options.body)
  }

  const headers = new Headers(options.headers)
  headers.set('accept', 'application/json')
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (isMutation) {
    const token = readCookie(CSRF_COOKIE)
    if (token) headers.set('x-csrf-token', token)
  }

  const response = await fetch(buildUrl(path, options.query), {
    ...options,
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      const loginUrl = new URL('/login', window.location.origin)
      loginUrl.searchParams.set('next', window.location.pathname)
      window.location.assign(loginUrl.toString())
    }
    const error = payload as { error?: string; code?: string; requestId?: string; details?: unknown } | null
    throw new ApiError(
      error?.error ?? `Request failed with status ${response.status}`,
      error?.code ?? 'INTERNAL_ERROR',
      response.status,
      error?.requestId,
      error?.details
    )
  }

  return (payload as { data: T }).data
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], init?: RequestInit) =>
    apiRequest<T>(path, { ...init, query }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    apiRequest<T>(path, { method: 'POST', body, query }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown, query?: RequestOptions['query']) =>
    apiRequest<T>(path, { method: 'DELETE', body, query }),
}
