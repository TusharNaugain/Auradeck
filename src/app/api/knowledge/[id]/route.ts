/**
 * /api/knowledge/[id] — detail (GET), update (PATCH), delete (DELETE).
 * Reading returns the full body; the list route only ever sends an excerpt.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { knowledgeUpdateSchema } from '@/lib/validations/knowledge'
import { slugify } from '@/lib/utils/slugify'
import { createAuditLog } from '@/lib/audit'
import { ConflictError, NotFoundError } from '@/lib/services/errors'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

async function loadArticle(id: string, organisationId: string) {
  const article = await db.knowledgeArticle.findFirst({ where: { id, organisationId } })
  if (!article) throw new NotFoundError('Article not found')
  return article
}

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.DASHBOARD_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const article = await loadArticle(id, organisationId)
  return NextResponse.json(
    { success: true, data: article, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.DASHBOARD_VIEW,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const article = await loadArticle(id, organisationId)
  const body = await parseJsonBody(req, knowledgeUpdateSchema)

  const nextSlug = body.slug ?? (body.title && body.title !== article.title ? slugify(body.title) : undefined)
  if (nextSlug && nextSlug !== article.slug) {
    const clash = await db.knowledgeArticle.findFirst({
      where: { slug: nextSlug, NOT: { id: article.id } },
      select: { id: true },
    })
    if (clash) throw new ConflictError('Another article already uses this slug')
  }

  const updated = await db.knowledgeArticle.update({
    where: { id: article.id },
    data: {
      title: body.title ?? undefined,
      slug: nextSlug,
      content: body.content ?? undefined,
      category: body.category ?? undefined,
      tags: body.tags ?? undefined,
      isPublic: body.isPublic ?? undefined,
      // Publishing is one-way in the UI: the first publish stamps the date.
      publishedAt: body.publish && !article.publishedAt ? new Date() : undefined,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'knowledge.update',
    resourceType: 'knowledge_article',
    resourceId: updated.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.SETTINGS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const article = await loadArticle(id, organisationId)
  await db.knowledgeArticle.delete({ where: { id: article.id } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'knowledge.delete',
    resourceType: 'knowledge_article',
    resourceId: article.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
