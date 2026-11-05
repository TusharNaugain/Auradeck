/**
 * Single source of truth for the client-facing session payload.
 * Used by GET /api/me and by the root server layout, so the shell and the API
 * can never disagree about who the viewer is or what they may see.
 */

import { getAuthContext } from '@/lib/permissions'
import type { getCurrentUser } from '@/lib/auth/session'

export interface SessionPayload {
  user: {
    id: string
    fullName: string
    email: string
    avatarUrl: string | null
    timezone: string
    locale: string
    mfaEnabled: boolean
    emailVerified: boolean
  }
  currentOrganisationId: string | null
  roleSlug: string | null
  scopeType: string | null
  permissions: string[]
  memberships: Array<{
    organisationId: string
    organisation: {
      id: string
      displayName: string
      slug: string
      type: string
      status: string
      logoUrl: string | null
    }
    role: { slug: string; name: string }
    isPrimary: boolean
  }>
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>

/**
 * Build the client-facing session payload from the already-hydrated session user.
 *
 * Performance: `getCurrentUser` already eagerly loads memberships (with organisation
 * and role) in its single DB query. We reuse that data directly — no extra DB round-trip.
 * `getAuthContext` is called in parallel with the membership mapping so the RBAC lookup
 * does not block payload construction.
 *
 * @param user - The hydrated user returned by `getCurrentUser`.
 */
export async function buildSessionPayload(user: SessionUser): Promise<SessionPayload> {
  // Run auth-context lookup in parallel — it may issue its own cached DB queries,
  // but we don't need to wait for it before mapping the membership data.
  const ctxPromise = user.currentOrganisationId
    ? getAuthContext(user.id, user.currentOrganisationId)
    : Promise.resolve(null)

  // Re-use memberships already loaded by getCurrentUser — avoids a redundant DB round-trip.
  // Sort primary membership first to match the previous db orderBy: { isPrimary: 'desc' }.
  const memberships = [...user.memberships].sort((a, b) =>
    Number(b.isPrimary) - Number(a.isPrimary)
  )

  const ctx = await ctxPromise

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      locale: user.locale,
      mfaEnabled: user.mfaEnabled,
      emailVerified: Boolean(user.emailVerifiedAt),
    },
    currentOrganisationId: user.currentOrganisationId ?? null,
    roleSlug: ctx?.roleSlug ?? null,
    scopeType: ctx?.scopeType ?? null,
    permissions: ctx ? Array.from(ctx.permissions) : [],
    memberships,
  }
}
