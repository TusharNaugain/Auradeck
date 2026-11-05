'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { api, ApiError, type RequestOptions } from '@/lib/client/api'
import type { SessionPayload } from '@/lib/auth/session-payload'

export type Session = SessionPayload

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<Session>('/api/me'),
    staleTime: 60_000,
    retry: 0,
  })
}

export function useHasPermission(permission: string) {
  const { data } = useSession()
  return Boolean(data?.permissions.includes(permission))
}

/** List/detail fetch against a paginated API route (`{ items, total }` envelope). */
export function useList<T>(key: QueryKey, path: string, query?: RequestOptions['query']) {
  return useQuery({
    queryKey: [...key, query ?? {}],
    queryFn: () => api.get<{ items: T[]; total: number; page: number; pageSize: number }>(path, query),
    placeholderData: keepPreviousData,
  })
}

/** Invalidate by prefix, e.g. `invalidate(['leads'])` after a mutation. */
export function useInvalidate() {
  const client = useQueryClient()
  return (...prefixes: QueryKey[]) => {
    for (const prefix of prefixes) void client.invalidateQueries({ queryKey: prefix })
  }
}

export function usePost<TRes>(path: string) {
  return useMutation({ mutationFn: (body?: unknown) => api.post<TRes>(path, body) })
}

export function usePatch<TRes>(path: string) {
  return useMutation({ mutationFn: (body?: unknown) => api.patch<TRes>(path, body) })
}

export function useDelete<TRes>(path: string) {
  return useMutation({ mutationFn: () => api.delete<TRes>(path) })
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
